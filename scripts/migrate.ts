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
 * MIGRATE_CONFIRM=<project ref>; any destructive statement needs MIGRATE_CONFIRM=<confirmValueFor(target)>,
 * which for a local target is the database name. Unknown `--` flags are rejected.
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
  sslFor,
  type Queryable,
} from '../src/db/migrate';

const DIR = path.resolve(__dirname, '../supabase/migrations');

const FLAGS = ['--hosted', '--db-url', '--baseline-only', '--down'];

/**
 * A typo'd `--hostd` would silently fall through to DATABASE_TEST_URL and a typo'd
 * `--down` would apply instead of revert. Benign outcomes, but this is the one script
 * that can touch production, so silence is the wrong default.
 */
export function rejectUnknownFlags(args: string[]): void {
  const bad = args.filter((a, i) => a.startsWith('--') && !FLAGS.includes(a) && args[i - 1] !== '--db-url');
  if (bad.length) throw new Error(`Unknown flag${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}. Known: ${FLAGS.join(', ')}`);
}

/**
 * Everything the CLI does once a connection is open, so it is testable with a fake
 * Queryable — the hosted-only `NOTIFY pgrst` in particular, which otherwise has no
 * coverage on the one code path that exclusively touches production.
 */
export async function run(
  client: Queryable,
  dir: string,
  opts: { args: string[]; hosted: boolean; confirmed: boolean; expected: string }
): Promise<void> {
  const { args, hosted, confirmed, expected } = opts;
  const needConfirm = (what: string) => {
    if (!confirmed) {
      throw new Error(
        `${what} contains destructive statements. Re-run with MIGRATE_CONFIRM=${expected} to proceed.`
      );
    }
  };
  let changed = false;
  try {
    // pg_cron is a Supabase extension; local databases have none, so its fence is stripped there.
    const applyOpts = { stripCron: !hosted };

    if (args.includes('--down')) {
      const newest = await newestApplied(client);
      const down = listMigrationFiles(dir).find((f) => f.version === newest)?.downPath;
      if (down && containsDestructive(fs.readFileSync(down, 'utf8'))) needConfirm('The down migration');
      const reverted = await revertLast(client, dir, applyOpts);
      changed = reverted !== null;
      console.log(reverted ? `Reverted ${path.basename(reverted.path)}` : 'Nothing to revert.');
    } else {
      if (args.includes('--baseline-only')) {
        console.log((await recordBaseline(client, dir)) ? 'Recorded baseline.' : 'Baseline already recorded.');
      }
      const pending = await pendingMigrations(client, dir);
      if (pending.some((f) => containsDestructive(fs.readFileSync(f.path, 'utf8')))) {
        needConfirm('A pending migration');
      }
      // Each migration commits on its own, so a failure part-way leaves earlier ones applied.
      changed = pending.length > 0;
      const applied = await applyPending(client, dir, applyOpts);
      for (const f of applied) console.log(`Applied ${path.basename(f.path)}`);
      if (!applied.length) console.log('Nothing to apply.');
    }
  } finally {
    // PostgREST caches function OIDs; without this a redefined RPC returns PGRST202. Runs even
    // after a partial apply, and must not mask the original error.
    if (hosted && changed) {
      await client.query("NOTIFY pgrst, 'reload schema'").catch((e: unknown) => console.error('NOTIFY failed:', e));
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  rejectUnknownFlags(args);
  // Throws before any connection exists when the target is missing or a hosted one is unconfirmed.
  const { url, expected, hosted, confirmed } = resolveTarget(args, process.env);

  const client = new Client({ connectionString: url, ...sslFor(url) });
  await client.connect();
  try {
    await run(client, DIR, { args, hosted, confirmed, expected });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
