/**
 * Seeds a demo team with believable traffic, for looking at the dashboard.
 *
 *   SEED_CONFIRM=uptimekit_sdd_test npx ts-node scripts/seed-dev.ts
 *
 * DATABASE_URL in this repo's .env points at production, so this script never
 * reads it. It uses DATABASE_TEST_URL and refuses to run unless SEED_CONFIRM
 * names that exact database — the same guard as backfill-daily-rollups.ts.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { sslFor } from '../src/db/migrate';

const MONITORS = [
  { name: 'api', url: 'https://api.acme.test/health', base: 140, status: 'up' },
  { name: 'checkout-api', url: 'https://checkout.acme.test/health', base: 220, status: 'down' },
  { name: 'web', url: 'https://acme.test', base: 310, status: 'up' },
  { name: 'cdn-edge', url: 'https://cdn.acme.test/ping', base: 45, status: 'up' },
  { name: 'auth-service', url: 'https://auth.acme.test/healthz', base: 180, status: 'degraded' },
  { name: 'search', url: 'https://search.acme.test/health', base: 520, status: 'up' },
];

const DAYS = 3;
const INTERVAL_SECONDS = 300;

/** Latency that drifts over the day and spikes during an outage. */
function latencyAt(base: number, minuteOfDay: number, inOutage: boolean): number {
  const diurnal = 1 + 0.25 * Math.sin((minuteOfDay / 1440) * 2 * Math.PI);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(base * diurnal * jitter * (inOutage ? 4 : 1));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_TEST_URL;
  if (!url) throw new Error('DATABASE_TEST_URL is not set');

  const dbName = new URL(url).pathname.slice(1);
  if (process.env.SEED_CONFIRM !== dbName) {
    throw new Error(
      `Refusing to seed. Re-run with SEED_CONFIRM=${dbName} once you are sure ` +
        `DATABASE_TEST_URL points where you think it does.`
    );
  }

  const client = new Client({ connectionString: url, ...sslFor(url) });
  await client.connect();

  try {
    await client.query('BEGIN');

    const { rows: [team] } = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('Acme Engineering') RETURNING id`
    );

    const now = Date.now();
    // One resolved outage yesterday and one still open on checkout-api.
    const outageStart = now - 26 * 3600 * 1000;
    const outageEnd = outageStart + 40 * 60 * 1000;
    const liveOutageStart = now - 4 * 60 * 1000;

    // ping_logs_raw is partitioned by day; back-dated rows need their partition
    // to exist first or the insert fails with "no partition of relation ... found".
    for (let d = 0; d <= DAYS; d++) {
      const day = new Date(now - d * 86400 * 1000).toISOString().slice(0, 10);
      await client.query('SELECT create_daily_partition($1::date)', [day]);
    }

    for (const m of MONITORS) {
      const { rows: [monitor] } = await client.query<{ id: string }>(
        `INSERT INTO monitors (team_id, name, url, check_interval, timeout_ms, status)
         VALUES ($1, $2, $3, $4, 10000, $5) RETURNING id`,
        [team.id, m.name, m.url, INTERVAL_SECONDS, m.status]
      );

      const points: string[] = [];
      const values: unknown[] = [];
      let n = 0;

      for (let t = now - DAYS * 86400 * 1000; t <= now; t += INTERVAL_SECONDS * 1000) {
        const isCheckout = m.name === 'checkout-api';
        const inOutage =
          isCheckout && ((t >= outageStart && t <= outageEnd) || t >= liveOutageStart);
        const minuteOfDay = new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();

        values.push(
          monitor.id,
          team.id,
          new Date(t).toISOString(),
          inOutage ? 0 : latencyAt(m.base, minuteOfDay, false),
          inOutage ? 503 : 200
        );
        points.push(`($${++n}, $${++n}, $${++n}, $${++n}, $${++n})`);
      }

      await client.query(
        `INSERT INTO ping_logs_raw (monitor_id, team_id, timestamp, response_time_ms, status_code)
         VALUES ${points.join(',')}`,
        values
      );

      if (m.name === 'checkout-api') {
        await client.query(
          `INSERT INTO incidents (team_id, monitor_id, started_at, resolved_at, cause)
           VALUES ($1, $2, $3, $4, 'HTTP 503'), ($1, $2, $5, NULL, 'HTTP 503')`,
          [team.id, monitor.id, new Date(outageStart), new Date(outageEnd), new Date(liveOutageStart)]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded team ${team.id} with ${MONITORS.length} monitors over ${DAYS} days.`);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
