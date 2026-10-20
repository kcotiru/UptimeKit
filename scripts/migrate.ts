/**
 * Migration runner CLI.
 *
 *   npm run migrate                       apply pending to DATABASE_TEST_URL
 *   npm run migrate -- --db-url <url>     apply pending to <url>
 *   npm run migrate -- --hosted           apply pending to DATABASE_URL (production)
 *   npm run migrate -- --baseline-only    record the baseline without running schema.sql, then apply pending
 *   npm run migrate:down                  revert the newest applied migration (combine with a target flag)
 *
 * DATABASE_TEST_URL never falls back to DATABASE_URL. --hosted needs
 * MIGRATE_CONFIRM=<project ref>; any destructive statement needs MIGRATE_CONFIRM=<confirmValueFor(target)>.
 * This script never imports src/worker/config/redis.ts (throws on missing DATABASE_URL, opens Redis).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import {
  applyPending,
  containsDestructive,
  listMigrationFiles,
  newestApplied,
  pendingMigrations,
  recordBaseline,
  resolveTarget,
  revertLast,
} from '../src/db/migrate';

const DIR = path.resolve(__dirname, '../supabase/migrations');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Throws before any connection exists when the target is missing or a hosted one is unconfirmed.
  const { url, expected, hosted, confirmed } = resolveTarget(args, process.env);
  const needConfirm = (what: string) => {
    if (!confirmed) {
      throw new Error(
        `${what} contains destructive statements. Re-run with MIGRATE_CONFIRM=${expected} to proceed.`
      );
    }
  };

  const client = new Client({ connectionString: url });
  await client.connect();
  let changed = false;
  try {
    // pg_cron is a Supabase extension; local databases have none, so its fence is stripped there.
    const opts = { stripCron: !hosted };

    if (args.includes('--down')) {
      const newest = await newestApplied(client);
      const down = listMigrationFiles(DIR).find((f) => f.version === newest)?.downPath;
      if (down && containsDestructive(fs.readFileSync(down, 'utf8'))) needConfirm('The down migration');
      const reverted = await revertLast(client, DIR, opts);
      changed = reverted !== null;
      console.log(reverted ? `Reverted ${path.basename(reverted.path)}` : 'Nothing to revert.');
    } else {
      if (args.includes('--baseline-only')) {
        console.log((await recordBaseline(client, DIR)) ? 'Recorded baseline.' : 'Baseline already recorded.');
      }
      const pending = await pendingMigrations(client, DIR);
      if (pending.some((f) => containsDestructive(fs.readFileSync(f.path, 'utf8')))) {
        needConfirm('A pending migration');
      }
      // Each migration commits on its own, so a failure part-way leaves earlier ones applied.
      changed = pending.length > 0;
      const applied = await applyPending(client, DIR, opts);
      for (const f of applied) console.log(`Applied ${path.basename(f.path)}`);
      if (!applied.length) console.log('Nothing to apply.');
    }
  } finally {
    // PostgREST caches function OIDs; without this a redefined RPC returns PGRST202. Runs even
    // after a partial apply, and must not mask the original error.
    if (hosted && changed) {
      await client.query("NOTIFY pgrst, 'reload schema'").catch((e: unknown) => console.error('NOTIFY failed:', e));
    }
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
