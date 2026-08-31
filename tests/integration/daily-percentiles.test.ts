import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';
import { RollupProcessor } from '../../src/worker/processors/rollup-processor';

// Same guard shape as tests/integration/shared-view-security.test.ts.
const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('daily percentiles', () => {
  let client: Client;
  let pool: Pool;
  let teamId: string;
  let monitorId: string;
  let day: string;
  let day2: string;
  let day3: string;
  let day4: string;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);
    await client.query("SET TIME ZONE 'UTC'");

    // ping_logs_raw is RANGE-partitioned by timestamp; the fixture below
    // inserts rows dated a few days in the past, so the covering partitions
    // must exist first. create_daily_partition() is CREATE TABLE IF NOT
    // EXISTS, so calling it here is safe and idempotent.
    day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    day2 = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    day3 = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    day4 = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    await client.query('SELECT create_daily_partition($1::date)', [day]);
    await client.query('SELECT create_daily_partition($1::date)', [day2]);
    await client.query('SELECT create_daily_partition($1::date)', [day3]);
    await client.query('SELECT create_daily_partition($1::date)', [day4]);

    // RollupProcessor.processRollup() calls this.dbPool.connect(), which on a
    // real Pool hands back a PoolClient; on a bare pg Client, .connect()
    // resolves to undefined instead, so the processor needs an actual Pool.
    pool = new Pool({ connectionString: process.env.DATABASE_TEST_URL });

    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('pctl') RETURNING id`
    );
    teamId = team.rows[0].id;

    const monitor = await client.query<{ id: string }>(
      `INSERT INTO monitors (team_id, name, url, check_interval) VALUES ($1, 'pctl', 'https://example.com', 60) RETURNING id`,
      [teamId]
    );
    monitorId = monitor.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (client) {
      // rollup_logs is keyed by (rollup_type, time_window) only, with no team
      // scope, and its idempotency check short-circuits processRollup() to
      // 'skipped' when a completed row already exists for that window. Since
      // `day`/`day2` are derived from Date.now(), a leftover row here would
      // silently poison every later run on the same calendar day.
      await client.query(
        `DELETE FROM rollup_logs WHERE rollup_type = 'hourly_to_daily'
           AND time_window IN ($1::timestamptz, $2::timestamptz, $3::timestamptz, $4::timestamptz)`,
        [`${day}T00:00:00Z`, `${day2}T00:00:00Z`, `${day3}T00:00:00Z`, `${day4}T00:00:00Z`]
      );
      await client.query('DELETE FROM ping_logs_daily WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM ping_logs_hourly WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM ping_logs_raw WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM monitors WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      await client.end();
    }
    if (pool) await pool.end();
  });

  it('takes daily percentiles from raw rows, not from percentiles of hourly percentiles', async () => {
    // Two hours, deliberately skewed so the two methods disagree loudly.
    // Hour A: 99 pings at 100ms.  Hour B: 1 ping at 10000ms.
    // True p95 over all 100 samples = 100ms (the 10000 sits at the very top).
    // Percentile-of-percentiles over the two hourly p95s (100, 10000) = 9505.
    for (let i = 0; i < 99; i++) {
      await client.query(
        `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code)
         VALUES ($1, $2, $3::timestamptz + make_interval(secs => $4), 100, 200)`,
        [teamId, monitorId, `${day}T01:00:00Z`, i]
      );
    }
    await client.query(
      `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3::timestamptz, 10000, 200)`,
      [teamId, monitorId, `${day}T02:00:00Z`]
    );

    await client.query(
      `INSERT INTO ping_logs_hourly
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES
         ($1, $2, $3::timestamptz,  99, 99,   100,   100,   100,   100,   100,   100),
         ($1, $2, $4::timestamptz,   1,  1, 10000, 10000, 10000, 10000, 10000, 10000)`,
      [teamId, monitorId, `${day}T01:00:00Z`, `${day}T02:00:00Z`]
    );

    const processor = new RollupProcessor(pool);
    const result = await processor.processRollup({
      rollupType: 'hourly_to_daily',
      timeWindow: `${day}T00:00:00.000Z`,
    });
    expect(result.status).toBe('completed');

    const { rows } = await client.query<{
      p95_response_time_ms: number;
      percentile_source: string;
      total_pings: number;
    }>(
      `SELECT p95_response_time_ms, percentile_source, total_pings
         FROM ping_logs_daily WHERE team_id = $1 AND monitor_id = $2`,
      [teamId, monitorId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].total_pings).toBe(100);
    expect(rows[0].percentile_source).toBe('raw');
    // Exact p95 of 99x100ms + 1x10000ms. The old percentile-of-percentiles
    // answer was ~9505 — if this assertion reads anything near that, the
    // percentiles are still coming from the hourly table.
    expect(rows[0].p95_response_time_ms).toBeLessThan(1000);
  });

  it('falls back to the hourly approximation when raw coverage is incomplete', async () => {
    // Same shape, but only SOME of the raw rows survive — exactly what a day
    // straddling the 7-day purge boundary looks like. A percentile computed
    // from a partial sample is silently wrong, so it must not be used.
    await client.query(
      `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3::timestamptz, 100, 200)`,
      [teamId, monitorId, `${day2}T01:00:00Z`]
    );

    await client.query(
      `INSERT INTO ping_logs_hourly
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3::timestamptz, 50, 50, 100, 100, 100, 100, 777, 900)`,
      [teamId, monitorId, `${day2}T01:00:00Z`]
    );

    const processor = new RollupProcessor(pool);
    await processor.processRollup({
      rollupType: 'hourly_to_daily',
      timeWindow: `${day2}T00:00:00.000Z`,
    });

    const { rows } = await client.query<{ p95_response_time_ms: number; percentile_source: string }>(
      `SELECT p95_response_time_ms, percentile_source
         FROM ping_logs_daily
        WHERE team_id = $1 AND monitor_id = $2 AND bucket_start = $3::timestamptz`,
      [teamId, monitorId, `${day2}T00:00:00Z`]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].percentile_source).toBe('hourly_approx');
    expect(rows[0].p95_response_time_ms).toBe(777);
  });

  it('never downgrades an already-exact daily row on re-run (e.g. the backfill script)', async () => {
    // First pass: raw coverage is complete, so the row lands with exact
    // percentiles from a skewed 2-value sample (50ms, 900ms) that the hourly
    // approximation (p95 = 100) would never happen to reproduce.
    await client.query(
      `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3::timestamptz, 50, 200), ($1, $2, $4::timestamptz, 900, 200)`,
      [teamId, monitorId, `${day3}T01:00:00Z`, `${day3}T01:00:30Z`]
    );
    await client.query(
      `INSERT INTO ping_logs_hourly
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3::timestamptz, 2, 2, 475, 50, 900, 100, 100, 100)`,
      [teamId, monitorId, `${day3}T01:00:00Z`]
    );

    const processor = new RollupProcessor(pool);
    await processor.processRollup({
      rollupType: 'hourly_to_daily',
      timeWindow: `${day3}T00:00:00.000Z`,
    });

    const first = await client.query<{ p95_response_time_ms: number; percentile_source: string }>(
      `SELECT p95_response_time_ms, percentile_source FROM ping_logs_daily
        WHERE team_id = $1 AND monitor_id = $2 AND bucket_start = $3::timestamptz`,
      [teamId, monitorId, `${day3}T00:00:00Z`]
    );
    expect(first.rows[0].percentile_source).toBe('raw');
    const exactP95 = first.rows[0].p95_response_time_ms;
    expect(exactP95).not.toBe(100); // must be the exact PERCENTILE_CONT over [50, 900], not the hourly approx

    // Second pass mimics scripts/backfill-daily-rollups.ts: raw rows for the
    // day have since aged out, and the rollup_logs marker is cleared so the
    // day is recomputed. Raw coverage is now zero, so the HAVING guard
    // correctly falls back to the (coarser) hourly approximation — but the
    // existing exact row must not be overwritten by it.
    await client.query('DELETE FROM ping_logs_raw WHERE team_id = $1 AND monitor_id = $2', [
      teamId,
      monitorId,
    ]);
    await client.query(
      `DELETE FROM rollup_logs WHERE rollup_type = 'hourly_to_daily' AND time_window = $1::timestamptz`,
      [`${day3}T00:00:00Z`]
    );

    await processor.processRollup({
      rollupType: 'hourly_to_daily',
      timeWindow: `${day3}T00:00:00.000Z`,
    });

    const second = await client.query<{ p95_response_time_ms: number; percentile_source: string }>(
      `SELECT p95_response_time_ms, percentile_source FROM ping_logs_daily
        WHERE team_id = $1 AND monitor_id = $2 AND bucket_start = $3::timestamptz`,
      [teamId, monitorId, `${day3}T00:00:00Z`]
    );
    expect(second.rows[0].percentile_source).toBe('raw');
    expect(second.rows[0].p95_response_time_ms).toBe(exactP95);
  });

  it('falls back to the hourly approximation when raw rows outnumber the hourly total (duplicates/late arrivals)', async () => {
    // The hourly bucket claims 1 ping, but 2 raw rows are present in that
    // window — the COUNT(*) > total_pings side of the completeness guard.
    await client.query(
      `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3::timestamptz, 100, 200), ($1, $2, $4::timestamptz, 200, 200)`,
      [teamId, monitorId, `${day4}T01:00:00Z`, `${day4}T01:00:30Z`]
    );
    await client.query(
      `INSERT INTO ping_logs_hourly
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3::timestamptz, 1, 1, 100, 100, 100, 100, 100, 100)`,
      [teamId, monitorId, `${day4}T01:00:00Z`]
    );

    const processor = new RollupProcessor(pool);
    await processor.processRollup({
      rollupType: 'hourly_to_daily',
      timeWindow: `${day4}T00:00:00.000Z`,
    });

    const { rows } = await client.query<{ percentile_source: string }>(
      `SELECT percentile_source FROM ping_logs_daily
        WHERE team_id = $1 AND monitor_id = $2 AND bucket_start = $3::timestamptz`,
      [teamId, monitorId, `${day4}T00:00:00Z`]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].percentile_source).toBe('hourly_approx');
  });
});
