import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';

// Same guard shape as tests/integration/shared-view-security.test.ts.
const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('tier query success_count / p50 / p99 / percentile_source', () => {
  let client: Client;
  let teamId: string;
  let monitorId: string;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);
    await client.query("SET TIME ZONE 'UTC'");

    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('tier-cols') RETURNING id`
    );
    teamId = team.rows[0].id;

    const monitor = await client.query<{ id: string }>(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'tier-cols', 'https://example.test', 60) RETURNING id`,
      [teamId]
    );
    monitorId = monitor.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.query('DELETE FROM ping_logs_daily WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM ping_logs_hourly WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM ping_logs_raw WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM saved_views WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM monitors WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      await client.end();
    }
  });

  it('raw tier: derives success_count from status_code, p50/p99 from the sample, percentile_source raw', async () => {
    const now = new Date();
    const t200 = new Date(now.getTime() - 3 * 60_000);
    const t503 = new Date(now.getTime() - 2 * 60_000);
    const tNull = new Date(now.getTime() - 1 * 60_000);

    await client.query(
      `INSERT INTO ping_logs_raw (monitor_id, team_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3, 111, 200), ($1, $2, $4, 222, 503), ($1, $2, $5, 333, NULL)`,
      [monitorId, teamId, t200, t503, tNull]
    );

    const from = new Date(now.getTime() - 10 * 60_000);
    const to = now;
    const { rows } = await client.query(
      `SELECT * FROM select_ping_tier_for_team($1, $2, $3, $4) ORDER BY ts ASC`,
      [teamId, monitorId, from, to]
    );

    expect(rows).toHaveLength(3);
    const [r200, r503, rNull] = rows;

    expect(r200.success_count).toBe(1);
    expect(r200.p50_time_ms).toBe(111);
    expect(r200.p99_time_ms).toBe(111);
    expect(r200.percentile_source).toBe('raw');

    expect(r503.success_count).toBe(0);
    expect(r503.p50_time_ms).toBe(222);
    expect(r503.p99_time_ms).toBe(222);
    expect(r503.percentile_source).toBe('raw');

    expect(rNull.success_count).toBe(0);
    expect(rNull.p50_time_ms).toBe(333);
    expect(rNull.p99_time_ms).toBe(333);
    expect(rNull.percentile_source).toBe('raw');
  });

  it('hourly tier: carries the stored successful_pings/p50/p99 through, percentile_source raw', async () => {
    // Older than the 7-day raw cutoff but inside the 90-day hourly window.
    const bucket = new Date(Date.now() - 10 * 86_400_000);
    bucket.setUTCMinutes(0, 0, 0);

    await client.query(
      `INSERT INTO ping_logs_hourly
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3, 60, 57, 150, 40, 900, 120, 400, 850)`,
      [teamId, monitorId, bucket]
    );

    const from = new Date(bucket.getTime() - 60 * 60_000);
    const to = new Date(bucket.getTime() + 60 * 60_000);
    const { rows } = await client.query(
      `SELECT * FROM select_ping_tier_for_team($1, $2, $3, $4)`,
      [teamId, monitorId, from, to]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].source_tier).toBe('hourly');
    expect(rows[0].success_count).toBe(57);
    expect(rows[0].p50_time_ms).toBe(120);
    expect(rows[0].p99_time_ms).toBe(850);
    expect(rows[0].percentile_source).toBe('raw');
  });

  it('daily tier: carries stored values through, percentile_source reflects the recorded provenance', async () => {
    const rawDay = new Date(Date.now() - 100 * 86_400_000);
    rawDay.setUTCHours(0, 0, 0, 0);
    const approxDay = new Date(rawDay.getTime() + 86_400_000);

    await client.query(
      `INSERT INTO ping_logs_daily
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms, percentile_source)
       VALUES
         ($1, $2, $3, 1000, 990, 160, 40, 900, 130, 420, 870, 'raw'),
         ($1, $2, $4, 1000, 980, 165, 45, 910, 140, 430, 880, 'hourly_approx')`,
      [teamId, monitorId, rawDay, approxDay]
    );

    const from = new Date(rawDay.getTime() - 60_000);
    const to = new Date(approxDay.getTime() + 60_000);
    const { rows } = await client.query(
      `SELECT * FROM select_ping_tier_for_team($1, $2, $3, $4) ORDER BY ts ASC`,
      [teamId, monitorId, from, to]
    );

    expect(rows).toHaveLength(2);
    const [raw, approx] = rows;

    expect(raw.source_tier).toBe('daily');
    expect(raw.success_count).toBe(990);
    expect(raw.p50_time_ms).toBe(130);
    expect(raw.p99_time_ms).toBe(870);
    expect(raw.percentile_source).toBe('raw');

    expect(approx.success_count).toBe(980);
    expect(approx.p50_time_ms).toBe(140);
    expect(approx.p99_time_ms).toBe(880);
    expect(approx.percentile_source).toBe('hourly_approx');
  });

  it('get_shared_view: still hides the URL, still works end to end, and now carries the four new columns', async () => {
    const now = new Date();
    const pingTime = new Date(now.getTime() - 5 * 60_000);
    await client.query(
      `INSERT INTO ping_logs_raw (monitor_id, team_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3, 250, 200)`,
      [monitorId, teamId, pingTime]
    );

    const from = new Date(now.getTime() - 30 * 60_000);
    const { rows: [view] } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, NULL, $2, 'Tier cols share', $3::jsonb) RETURNING share_token`,
      [teamId, monitorId, JSON.stringify({ from: from.toISOString(), to: now.toISOString() })]
    );

    const { rows, fields } = await client.query('SELECT * FROM get_shared_view($1)', [
      view.share_token,
    ]);

    expect(fields.map((f) => f.name)).not.toContain('url');
    const fieldNames = fields.map((f) => f.name);
    expect(fieldNames).toEqual(
      expect.arrayContaining(['success_count', 'p50_time_ms', 'p99_time_ms', 'percentile_source'])
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].success_count).toBe(1);
    expect(rows[0].p50_time_ms).toBe(250);
    expect(rows[0].p99_time_ms).toBe(250);
    expect(rows[0].percentile_source).toBe('raw');
  });

  it('re-applying schema.sql twice in a row succeeds (idempotence)', async () => {
    await expect(applySchema(client)).resolves.not.toThrow();
    await expect(applySchema(client)).resolves.not.toThrow();
  });
});
