import { Pool } from 'pg';
import { RollupJobPayload } from '../queues/types';

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
    const { rollupType, timeWindow } = jobData;
    const client = await this.dbPool.connect();

    try {
      await client.query('BEGIN');

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
          WHERE timestamp >= $1::timestamp AND timestamp < ($1::timestamp + INTERVAL '1 hour')
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
          INSERT INTO ping_logs_daily (
            team_id, monitor_id, bucket_start, total_pings, successful_pings,
            avg_response_time_ms, min_response_time_ms, max_response_time_ms,
            p50_response_time_ms, p95_response_time_ms, p99_response_time_ms
          )
          SELECT
            team_id,
            monitor_id,
            date_trunc('day', bucket_start) AS bucket_start,
            SUM(total_pings)::int AS total_pings,
            SUM(successful_pings)::int AS successful_pings,
            ROUND(AVG(avg_response_time_ms))::int AS avg_response_time_ms,
            MIN(min_response_time_ms)::int AS min_response_time_ms,
            MAX(max_response_time_ms)::int AS max_response_time_ms,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY p50_response_time_ms)::int AS p50_response_time_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p95_response_time_ms)::int AS p95_response_time_ms,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY p99_response_time_ms)::int AS p99_response_time_ms
          FROM ping_logs_hourly
          WHERE bucket_start >= $1::timestamp AND bucket_start < ($1::timestamp + INTERVAL '1 day')
          GROUP BY team_id, monitor_id, date_trunc('day', bucket_start)
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
