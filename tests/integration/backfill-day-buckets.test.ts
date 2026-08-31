import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';
import { DISTINCT_DAYS_SQL } from '../../scripts/backfill-daily-rollups';

// Same guard shape as tests/integration/shared-view-security.test.ts:5-6 —
// match the existing pattern rather than introducing describe.skipIf.
const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('backfill day bucketing', () => {
  let client: Client;
  let teamId: string;
  let monitorId: string;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);

    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('backfill-tz') RETURNING id`
    );
    teamId = team.rows[0].id;

    const monitor = await client.query<{ id: string }>(
      `INSERT INTO monitors (team_id, name, url, check_interval) VALUES ($1, 'tz', 'https://example.com', 60) RETURNING id`,
      [teamId]
    );
    monitorId = monitor.rows[0].id;

    // Two hourly buckets that land on the SAME UTC day but on DIFFERENT days
    // in a far-eastern zone: 22:00Z and 23:00Z on 2026-03-10 are both
    // 2026-03-11 in Pacific/Kiritimati (UTC+14).
    for (const ts of ['2026-03-10T22:00:00Z', '2026-03-10T23:00:00Z']) {
      await client.query(
        `INSERT INTO ping_logs_hourly
           (team_id, monitor_id, bucket_start, total_pings, successful_pings,
            avg_response_time_ms, min_response_time_ms, max_response_time_ms,
            p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
         VALUES ($1, $2, $3, 10, 10, 100, 100, 100, 100, 100, 100)`,
        [teamId, monitorId, ts]
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.query('DELETE FROM ping_logs_hourly WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM monitors WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      await client.end();
    }
  });

  it('buckets by UTC day regardless of the session timezone', async () => {
    // The real script runs on a pool, so it cannot rely on any session state.
    // Setting a hostile zone here is what a wrong connection would look like.
    await client.query("SET TIME ZONE 'Pacific/Kiritimati'");

    const { rows } = await client.query<{ bucket: Date }>(DISTINCT_DAYS_SQL);

    const buckets = rows.map((r) => r.bucket.toISOString());
    expect(buckets).toEqual(['2026-03-10T00:00:00.000Z']);
  });

  it('produces the same buckets under UTC', async () => {
    await client.query("SET TIME ZONE 'UTC'");

    const { rows } = await client.query<{ bucket: Date }>(DISTINCT_DAYS_SQL);

    expect(rows.map((r) => r.bucket.toISOString())).toEqual(['2026-03-10T00:00:00.000Z']);
  });
});
