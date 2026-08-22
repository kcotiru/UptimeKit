/**
 * One-shot: recompute every ping_logs_daily row still reachable from hourly data.
 * Run once after deploying the weighted-average fix, then delete or ignore.
 *
 *   npx ts-node scripts/backfill-daily-rollups.ts
 */
import { dbPool } from '../src/worker/config/redis';
import { RollupProcessor } from '../src/worker/processors/rollup-processor';

async function main(): Promise<void> {
  // Matches the `SET LOCAL TIME ZONE 'UTC'` rollup-processor.ts pins inside its
  // own transaction. This query runs outside that transaction on the bare
  // pool, so without pinning the session zone here too, date_trunc('day', ...)
  // below would snap to day boundaries in whatever zone the connection
  // defaults to — and this is the one script whose job is fixing wrong data,
  // with no idempotent retry (it deletes the rollup_logs marker first).
  await dbPool.query("SET TIME ZONE 'UTC'");

  const processor = new RollupProcessor(dbPool);

  const { rows } = await dbPool.query<{ bucket: Date }>(
    `SELECT DISTINCT date_trunc('day', bucket_start) AS bucket
       FROM ping_logs_hourly
      ORDER BY bucket ASC`
  );

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
  // Importing `dbPool` from config/redis also opens an ioredis connection
  // (redisConnection) as a side effect, and nothing here ever closes it.
  // That open socket is an active event-loop handle, so without a hard
  // exit the process hangs forever after printing its last log line.
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[Backfill] Failed:', err);
  process.exit(1);
});
