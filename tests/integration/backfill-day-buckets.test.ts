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
  let utcDay: string;
  // Scope to this fixture's monitor: DISTINCT_DAYS_SQL deliberately has no
  // team/monitor filter (production wants every day, globally), so without
  // this the assertions below are coupled to whatever else is in
  // ping_logs_hourly — a leftover row from a crashed prior run would poison
  // this file permanently.
  const scopedDaysSql = DISTINCT_DAYS_SQL.replace(
    'WHERE bucket_start',
    'WHERE monitor_id = $1 AND bucket_start'
  );

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

    // Ten days back: comfortably inside the backfill's 90-day repairable
    // window, and 22:00Z/23:00Z are still the NEXT day in Pacific/Kiritimati
    // (UTC+14), which is what makes this test discriminate.
    utcDay = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

    // Two hourly buckets that land on the SAME UTC day but on DIFFERENT days
    // in a far-eastern zone: 22:00Z and 23:00Z on utcDay are both the next
    // calendar day in Pacific/Kiritimati (UTC+14).
    for (const ts of [`${utcDay}T22:00:00Z`, `${utcDay}T23:00:00Z`]) {
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

    const { rows } = await client.query<{ bucket: Date }>(scopedDaysSql, [monitorId]);

    const buckets = rows.map((r) => r.bucket.toISOString());
    expect(buckets).toEqual([`${utcDay}T00:00:00.000Z`]);
  });

  it('produces the same buckets under UTC', async () => {
    await client.query("SET TIME ZONE 'UTC'");

    const { rows } = await client.query<{ bucket: Date }>(scopedDaysSql, [monitorId]);

    expect(rows.map((r) => r.bucket.toISOString())).toEqual([`${utcDay}T00:00:00.000Z`]);
  });
});
