import { Pool } from 'pg';
import { RollupJobPayload } from '../queues/types';

/**
 * The bucket a cron firing should roll up: the hour (or day) that just closed.
 * Always UTC, matching the `SET LOCAL TIME ZONE 'UTC'` the rollup runs under.
 */
export function closedBucket(
  rollupType: RollupJobPayload['rollupType'],
  now: Date = new Date()
): string {
  const d = new Date(now);
  if (rollupType === 'raw_to_hourly') {
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() - 1);
  } else {
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString();
}

/**
 * The daily average the hourly_to_daily SQL computes, expressed in TypeScript so
 * the weighting is testable without a database. Keep the two in step: an hour is
 * weighted by its ping count, because a quiet hour is not worth a busy one.
 */
export function weightedAverage(rows: Array<{ avg: number; count: number }>): number {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return 0;
  return Math.round(rows.reduce((sum, r) => sum + r.avg * r.count, 0) / total);
}

export interface IRollupProcessor {
  processRollup(jobData: RollupJobPayload): Promise<{
    status: 'completed' | 'skipped' | 'failed';
    inputCount: number;
    outputCount: number;
  }>;
}

export class RollupProcessor implements IRollupProcessor {
  private dbPool: Pool;

  constructor(dbPool: Pool) {
    this.dbPool = dbPool;
  }

  /**
   * Executes transactional raw-to-hourly or hourly-to-daily statistical data rollups,
   * enforces 7-day raw / 90-day hourly retention purges, and tracks execution state in rollup_logs.
   */
  async processRollup(jobData: RollupJobPayload): Promise<{
    status: 'completed' | 'skipped' | 'failed';
    inputCount: number;
    outputCount: number;
  }> {
    const { rollupType } = jobData;
    // Cron jobs carry no window (their data is static); callers and tests may pass one.
    const timeWindow = jobData.timeWindow ?? closedBucket(rollupType);
    const client = await this.dbPool.connect();

    try {
      await client.query('BEGIN');
      // Bucket boundaries below are UTC; date_trunc and timestamptz casts both
      // follow the session zone, so pin it rather than trust the server default.
      await client.query("SET LOCAL TIME ZONE 'UTC'");

      // 1. Idempotency Check
      const checkRes = await client.query(
        `SELECT status FROM rollup_logs WHERE rollup_type = $1 AND time_window = $2`,
        [rollupType, timeWindow]
      );

      if (checkRes.rows.length > 0 && checkRes.rows[0].status === 'completed') {
        await client.query('ROLLBACK');
        return { status: 'skipped', inputCount: 0, outputCount: 0 };
      }

      // 2. Advisory Lock to prevent concurrent execution for same window
      const lockKey = `${rollupType}:${timeWindow}`;
      const lockRes = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext($1)) as acquired`, [lockKey]);

      if (!lockRes.rows[0].acquired) {
        await client.query('ROLLBACK');
        return { status: 'skipped', inputCount: 0, outputCount: 0 };
      }

      const inputCount = 0;
      let outputCount = 0;

      if (rollupType === 'raw_to_hourly') {
        // Compute hourly percentile & average stats from ping_logs_raw
        const aggregateQuery = `
          INSERT INTO ping_logs_hourly (
            team_id, monitor_id, bucket_start, total_pings, successful_pings,
            avg_response_time_ms, min_response_time_ms, max_response_time_ms,
            p50_response_time_ms, p95_response_time_ms, p99_response_time_ms
          )
          SELECT
            team_id,
            monitor_id,
            date_trunc('hour', timestamp) AS bucket_start,
            COUNT(*)::int AS total_pings,
            COUNT(*) FILTER (WHERE status_code IS NOT NULL AND status_code >= 200 AND status_code < 400)::int AS successful_pings,
            ROUND(AVG(response_time_ms))::int AS avg_response_time_ms,
            MIN(response_time_ms)::int AS min_response_time_ms,
            MAX(response_time_ms)::int AS max_response_time_ms,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)::int AS p50_response_time_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int AS p95_response_time_ms,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)::int AS p99_response_time_ms
          FROM ping_logs_raw
          WHERE timestamp >= $1::timestamptz AND timestamp < ($1::timestamptz + INTERVAL '1 hour')
          GROUP BY team_id, monitor_id, date_trunc('hour', timestamp)
          ON CONFLICT (team_id, monitor_id, bucket_start) DO UPDATE SET
            total_pings = EXCLUDED.total_pings,
            successful_pings = EXCLUDED.successful_pings,
            avg_response_time_ms = EXCLUDED.avg_response_time_ms,
            min_response_time_ms = EXCLUDED.min_response_time_ms,
            max_response_time_ms = EXCLUDED.max_response_time_ms,
            p50_response_time_ms = EXCLUDED.p50_response_time_ms,
            p95_response_time_ms = EXCLUDED.p95_response_time_ms,
            p99_response_time_ms = EXCLUDED.p99_response_time_ms
        `;
        const aggRes = await client.query(aggregateQuery, [timeWindow]);
        outputCount = aggRes.rowCount || 0;

        // Retention Purge: Delete raw ping logs older than 7 days
        await client.query(`DELETE FROM ping_logs_raw WHERE timestamp < (NOW() - INTERVAL '7 days')`);
      } else if (rollupType === 'hourly_to_daily') {
        const aggregateQuery = `
          WITH h AS (
            SELECT
              team_id,
              monitor_id,
              date_trunc('day', bucket_start) AS bucket_start,
              SUM(total_pings)::int AS total_pings,
              SUM(successful_pings)::int AS successful_pings,
              -- Weighted by ping count: see weightedAverage() in this file.
              -- NULLIF avoids the division-by-zero error when a day's hourly rows
              -- are all empty; COALESCE then turns that NULL back into 0 so the
              -- NOT NULL column is satisfied and this matches weightedAverage()'s
              -- all-zero-count case (which returns 0) exactly.
              COALESCE(ROUND(SUM(avg_response_time_ms::numeric * total_pings)
                    / NULLIF(SUM(total_pings), 0)), 0)::int AS avg_response_time_ms,
              MIN(min_response_time_ms)::int AS min_response_time_ms,
              MAX(max_response_time_ms)::int AS max_response_time_ms,
              -- Percentiles OF hourly percentiles. Kept only as the fallback for
              -- days whose raw rows have aged out or are partially purged.
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY p50_response_time_ms)::int AS approx_p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p95_response_time_ms)::int AS approx_p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY p99_response_time_ms)::int AS approx_p99
            FROM ping_logs_hourly
            WHERE bucket_start >= $1::timestamptz AND bucket_start < ($1::timestamptz + INTERVAL '1 day')
            GROUP BY team_id, monitor_id, date_trunc('day', bucket_start)
          )
          INSERT INTO ping_logs_daily (
            team_id, monitor_id, bucket_start, total_pings, successful_pings,
            avg_response_time_ms, min_response_time_ms, max_response_time_ms,
            p50_response_time_ms, p95_response_time_ms, p99_response_time_ms,
            percentile_source
          )
          SELECT
            h.team_id,
            h.monitor_id,
            h.bucket_start,
            h.total_pings,
            h.successful_pings,
            h.avg_response_time_ms,
            h.min_response_time_ms,
            h.max_response_time_ms,
            COALESCE(r.p50, h.approx_p50),
            COALESCE(r.p95, h.approx_p95),
            COALESCE(r.p99, h.approx_p99),
            CASE WHEN r.p95 IS NULL THEN 'hourly_approx' ELSE 'raw' END
          FROM h
          -- The raw rows for this day are still inside the 7-day retention window
          -- when the scheduled rollup runs, so the exact percentile is available
          -- and no mergeable sketch is needed. HAVING pins completeness rather
          -- than mere presence: a day straddling the purge boundary keeps SOME
          -- raw rows, and a percentile over a partial sample is silently wrong in
          -- a way the approximation is not. Count mismatch => fall back.
          LEFT JOIN LATERAL (
            SELECT
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)::int AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)::int AS p99
            FROM ping_logs_raw
            WHERE team_id = h.team_id
              AND monitor_id = h.monitor_id
              AND timestamp >= h.bucket_start
              AND timestamp < h.bucket_start + INTERVAL '1 day'
            HAVING COUNT(*) = h.total_pings AND COUNT(*) > 0
          ) r ON TRUE
          ON CONFLICT (team_id, monitor_id, bucket_start) DO UPDATE SET
            total_pings = EXCLUDED.total_pings,
            successful_pings = EXCLUDED.successful_pings,
            avg_response_time_ms = EXCLUDED.avg_response_time_ms,
            min_response_time_ms = EXCLUDED.min_response_time_ms,
            max_response_time_ms = EXCLUDED.max_response_time_ms,
            -- Never downgrade: scripts/backfill-daily-rollups.ts re-runs this
            -- rollup for old days whose raw rows have since aged out of the
            -- 7-day retention window, so a day that once landed with exact
            -- ('raw') percentiles can be recomputed later with only the
            -- hourly approximation available. Keep the existing exact values
            -- rather than silently overwriting them with a coarser estimate.
            p50_response_time_ms = CASE
              WHEN ping_logs_daily.percentile_source = 'raw' AND EXCLUDED.percentile_source <> 'raw'
              THEN ping_logs_daily.p50_response_time_ms ELSE EXCLUDED.p50_response_time_ms END,
            p95_response_time_ms = CASE
              WHEN ping_logs_daily.percentile_source = 'raw' AND EXCLUDED.percentile_source <> 'raw'
              THEN ping_logs_daily.p95_response_time_ms ELSE EXCLUDED.p95_response_time_ms END,
            p99_response_time_ms = CASE
              WHEN ping_logs_daily.percentile_source = 'raw' AND EXCLUDED.percentile_source <> 'raw'
              THEN ping_logs_daily.p99_response_time_ms ELSE EXCLUDED.p99_response_time_ms END,
            percentile_source = CASE
              WHEN ping_logs_daily.percentile_source = 'raw' AND EXCLUDED.percentile_source <> 'raw'
              THEN ping_logs_daily.percentile_source ELSE EXCLUDED.percentile_source END
        `;
        const aggRes = await client.query(aggregateQuery, [timeWindow]);
        outputCount = aggRes.rowCount || 0;

        // Retention Purge: Delete hourly ping logs older than 90 days
        await client.query(`DELETE FROM ping_logs_hourly WHERE bucket_start < (NOW() - INTERVAL '90 days')`);
      }

      // Upsert into rollup_logs
      const logUpsert = `
        INSERT INTO rollup_logs (rollup_type, time_window, status, input_records, output_records, executed_at)
        VALUES ($1, $2, 'completed', $3, $4, NOW())
        ON CONFLICT (rollup_type, time_window) DO UPDATE SET
          status = 'completed',
          output_records = EXCLUDED.output_records,
          executed_at = NOW()
      `;
      await client.query(logUpsert, [rollupType, timeWindow, inputCount, outputCount]);

      await client.query('COMMIT');
      return { status: 'completed', inputCount, outputCount };
    } catch (err: unknown) {
      const error = err as Error;
      await client.query('ROLLBACK');

      // Log failure state if possible
      try {
        await this.dbPool.query(
          `INSERT INTO rollup_logs (rollup_type, time_window, status, error_message, executed_at)
           VALUES ($1, $2, 'failed', $3, NOW())
           ON CONFLICT (rollup_type, time_window) DO UPDATE SET status = 'failed', error_message = EXCLUDED.error_message`,
          [rollupType, timeWindow, error.message]
        );
      } catch (_ignoredError: unknown) {
        /* ignore failure logging error */
      }

      throw error;
    } finally {
      client.release();
    }
  }
}
