/**
 * One-shot: recompute every ping_logs_daily row still reachable from hourly data.
 * Run once after deploying the weighted-average fix, then delete or ignore.
 *
 *   BACKFILL_CONFIRM=1 npx ts-node scripts/backfill-daily-rollups.ts
 *
 * This deletes rollup_logs markers and rewrites ping_logs_daily. It targets
 * whatever DATABASE_URL points at, which in this repo's .env is production, so
 * it refuses to run without BACKFILL_CONFIRM=1 and prints its target first.
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
   ORDER BY bucket ASC
`;

async function main(): Promise<void> {
  if (process.env.BACKFILL_CONFIRM !== '1') {
    console.error(
      '[Backfill] Refusing to run. This DELETEs rollup_logs markers and rewrites\n' +
        '           ping_logs_daily on whatever DATABASE_URL points at.\n' +
        '           Re-run with BACKFILL_CONFIRM=1 once you have checked the target.'
    );
    process.exit(1);
  }

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

  // Show the target without leaking the password.
  console.log(`[Backfill] target: ${(process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@')}`);

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
