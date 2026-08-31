/**
 * One-shot: recompute every ping_logs_daily row still reachable from hourly data.
 * Run once after deploying the weighted-average fix, then delete or ignore.
 *
 *   BACKFILL_CONFIRM=<database-name> npx ts-node scripts/backfill-daily-rollups.ts
 *
 * This deletes rollup_logs markers and rewrites ping_logs_daily. It targets
 * whatever DATABASE_URL points at, which in this repo's .env is production, so
 * it refuses to run unless BACKFILL_CONFIRM names that exact database.
 *
 * Days whose hourly source has already aged out of the 90-day retention
 * window cannot be recomputed: RollupProcessor.processRollup('hourly_to_daily')
 * purges ping_logs_hourly rows older than 90 days as a side effect of every
 * call (src/worker/processors/rollup-processor.ts), so a day outside that
 * window would aggregate zero source rows on this loop's first iteration and
 * silently report "completed (0 rows)". DISTINCT_DAYS_SQL is bounded to the
 * same 90-day window for that reason.
 */

/**
 * Every distinct UTC day that has hourly data.
 *
 * Bucketing is done entirely inside the expression rather than by pinning the
 * session with `SET TIME ZONE 'UTC'`. This runs on a pool: a SET applies to one
 * checked-out connection and the next query can be served by a different one,
 * so a session pin here is not a guarantee, it is a coincidence. `AT TIME ZONE
 * 'UTC'` converts the timestamptz to a UTC wall-clock timestamp, date_trunc
 * finds UTC midnight, and the second `AT TIME ZONE 'UTC'` converts back to
 * timestamptz so node-pg hands back a correct Date.
 */
export const DISTINCT_DAYS_SQL = `
  SELECT DISTINCT
         (date_trunc('day', bucket_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket
    FROM ping_logs_hourly
   WHERE bucket_start >= now() - INTERVAL '90 days'
   ORDER BY bucket ASC
`;

async function main(): Promise<void> {
  // Target-named guard, checked before anything else touches the network:
  // reading process.env.DATABASE_URL directly is safe, but requiring
  // src/worker/config/redis below constructs a real Pool/ioredis connection
  // as a side effect, so the guard must run first.
  const target = new URL(process.env.DATABASE_URL || 'postgres:///').pathname.slice(1);
  if (process.env.BACKFILL_CONFIRM !== target) {
    console.error(
      `[Backfill] Refusing to run. This DELETEs rollup_logs markers and rewrites\n` +
        `           ping_logs_daily on database "${target}".\n` +
        `           Re-run with BACKFILL_CONFIRM=${target} if that is what you intend.`
    );
    process.exit(1);
  }

  // Show the target without leaking the password, before anything opens a
  // connection.
  console.log(`[Backfill] target: ${(process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@')}`);

  // Imported lazily: src/worker/config/redis also opens an ioredis connection at
  // module load, which would make this file un-importable from a test.
  // require(), not a dynamic import(): this file compiles to CommonJS (no
  // "type" in package.json), and Node's dynamic import() always resolves
  // through the ESM loader regardless of the compiled output's module kind,
  // which can't find a path ts-node's CJS require hook would resolve fine.
  // require() is still lazy — it only runs once main() is entered, which is
  // the whole point: importing this module for DISTINCT_DAYS_SQL must not
  // open an ioredis connection as a side effect.
  const { dbPool } = require('../src/worker/config/redis') as typeof import('../src/worker/config/redis');
  const { RollupProcessor } =
    require('../src/worker/processors/rollup-processor') as typeof import('../src/worker/processors/rollup-processor');

  const processor = new RollupProcessor(dbPool);

  const { rows } = await dbPool.query<{ bucket: Date }>(DISTINCT_DAYS_SQL);

  console.log(`[Backfill] ${rows.length} day(s) to recompute`);

  for (const { bucket } of rows) {
    const timeWindow = bucket.toISOString();

    // The processor short-circuits on a 'completed' rollup_logs row, so clear the
    // marker first or every window returns 'skipped'.
    await dbPool.query(
      `DELETE FROM rollup_logs WHERE rollup_type = 'hourly_to_daily' AND time_window = $1`,
      [timeWindow]
    );

    const result = await processor.processRollup({ rollupType: 'hourly_to_daily', timeWindow });
    console.log(`[Backfill] ${timeWindow} -> ${result.status} (${result.outputCount} rows)`);
  }

  await dbPool.end();
  // Importing dbPool from config/redis also opens an ioredis connection
  // (redisConnection) as a side effect, and nothing here ever closes it.
  // That open socket is an active event-loop handle, so without a hard
  // exit the process hangs forever after printing its last log line.
  process.exit(0);
}

// Guarded so importing this module for its SQL does not run the backfill.
// CommonJS: package.json has no "type" field and tsconfig sets module NodeNext.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('[Backfill] Failed:', err);
    process.exit(1);
  });
}
