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
  confirmValueFor,
  containsDestructive,
  isHostedUrl,
  listMigrationFiles,
  pendingMigrations,
  recordBaseline,
  revertLast,
} from '../src/db/migrate';

const DIR = path.resolve(__dirname, '../supabase/migrations');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (f: string) => args.includes(f);
  const dbUrlIdx = args.indexOf('--db-url');
  const explicit = dbUrlIdx >= 0 ? args[dbUrlIdx + 1] : undefined;
  if (dbUrlIdx >= 0 && !explicit) throw new Error('--db-url needs a value');
  if (explicit && flag('--hosted')) throw new Error('--db-url and --hosted are mutually exclusive');

  const url = flag('--hosted')
    ? process.env.DATABASE_URL
    : (explicit ?? process.env.DATABASE_TEST_URL);
  if (!url) {
    throw new Error(
      flag('--hosted')
        ? 'DATABASE_URL is not set'
        : 'No target: set DATABASE_TEST_URL or pass --db-url <url> (or --hosted)'
    );
  }

  const hosted = isHostedUrl(url);
  const expected = confirmValueFor(url);
  const confirmed = process.env.MIGRATE_CONFIRM === expected;
  // Refuse before any connection is opened.
  if ((flag('--hosted') || hosted) && !confirmed) {
    throw new Error(
      `Refusing to touch a hosted database. Re-run with MIGRATE_CONFIRM=${expected} ` +
        `once you are sure the target is the one you intend.`
    );
  }
  const needConfirm = (what: string) => {
    if (!confirmed) {
      throw new Error(
        `${what} contains destructive statements. Re-run with MIGRATE_CONFIRM=${expected} to proceed.`
      );
    }
  };

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // pg_cron is a Supabase extension; local databases have none, so its fence is stripped there.
    const opts = { stripCron: !hosted };

    if (flag('--down')) {
      const newest = (await client.query(
        'SELECT max(version) AS v FROM supabase_migrations.schema_migrations'
      ).catch(() => ({ rows: [{ v: null }] }))).rows[0].v as string | null;
      const down = listMigrationFiles(DIR).find((f) => f.version === newest)?.downPath;
      if (down && containsDestructive(fs.readFileSync(down, 'utf8'))) needConfirm('The down migration');
      const reverted = await revertLast(client, DIR, opts);
      console.log(reverted ? `Reverted ${path.basename(reverted.path)}` : 'Nothing to revert.');
    } else {
      if (flag('--baseline-only')) {
        console.log((await recordBaseline(client, DIR)) ? 'Recorded baseline.' : 'Baseline already recorded.');
      }
      const pending = await pendingMigrations(client, DIR);
      if (pending.some((f) => containsDestructive(fs.readFileSync(f.path, 'utf8')))) {
        needConfirm('A pending migration');
      }
      const applied = await applyPending(client, DIR, opts);
      for (const f of applied) console.log(`Applied ${path.basename(f.path)}`);
      if (!applied.length) console.log('Nothing to apply.');
    }

    // PostgREST caches function OIDs; without this a redefined RPC returns PGRST202.
    if (hosted) await client.query("NOTIFY pgrst, 'reload schema'");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
