import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { applyPending, confirmValueFor, recordBaseline, stripPgCronFence } from '../../../src/db/migrate';

dotenv.config();

// No DATABASE_URL fallback, deliberately: in this environment DATABASE_URL
// points at a real production Supabase project, and applySchema()/seed helpers
// run DDL and fixture inserts. A DB-backed test missing its skip guard would
// hit prod instead of failing loudly. A test database must be named explicitly
// via DATABASE_TEST_URL.
//
// Naming it explicitly is not the same as naming something safe, though: nothing
// stopped DATABASE_TEST_URL from *being* the production URL. `npm run migrate`
// refuses that (resolveTarget demands MIGRATE_CONFIRM for a hosted target);
// `npm test` would have accepted it and then applied schema.sql, recorded the
// baseline and written fixtures. assertNotProduction() below closes that.
const testDbUrl = process.env.DATABASE_TEST_URL || '';

/** confirmValueFor, or null when the URL is unset or cannot be classified. Never throws. */
function projectOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return confirmValueFor(url);
  } catch {
    return null;
  }
}

/**
 * Refuses a test target that resolves to the same project (or local database) as
 * DATABASE_URL. Deliberately NOT a blanket hosted refusal: pointing the tests at a
 * *separate* Supabase project is legitimate, and `getTestClient`'s ssl branch supports it.
 * DATABASE_URL is routinely unset for contributors and confirmValueFor throws on a URL it
 * cannot classify, so an unset or unclassifiable side compares as null and never blocks.
 */
function assertNotProduction(): void {
  const test = projectOf(testDbUrl);
  const prod = projectOf(process.env.DATABASE_URL);
  if (test && prod && test === prod) {
    throw new Error(
      `DATABASE_TEST_URL resolves to the same target as DATABASE_URL ("${test}"). ` +
        'These tests apply the schema and write fixtures: point DATABASE_TEST_URL at a throwaway database.'
    );
  }
}

/**
 * Creates and returns an active pg Client connected to test database.
 */
export async function getTestClient(): Promise<Client> {
  assertNotProduction();
  const client = new Client({
    connectionString: testDbUrl,
    // Supabase requires TLS; its cert chain isn't in the local trust store.
    ssl: testDbUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  return client;
}

// schema.sql runs as one multi-statement query here (unlike psql, which keeps
// going statement-by-statement), so a single failing statement aborts every
// statement after it. A local Postgres has no pg_cron extension available
// (pg_available_extensions has no row for it, and pg_cron has no Windows
// support at all), so `CREATE EXTENSION IF NOT EXISTS pg_cron` throws and the
// rest of schema.sql never applies.
//
// Strip the whole fenced region. The fence is explicit sentinel comments
// rather than a match on the block's `$job$` dollar-quote: the old anchor
// stopped at cron.schedule()'s closing paren, so anything appended after it
// (such as the cron.job postcondition assertion) silently escaped the strip
// and broke every DB-backed test. tests/integration/partitioning.test.ts
// asserts that no `cron.` reference survives outside the sentinels.
//
// This fenced region is the one part of schema.sql with zero local test
// coverage: nothing in this repo's test suite ever executes it. Only
// pg_cron statements belong inside the fence; anything else placed there
// silently escapes every DB-backed test.
//
// `g` flag: without it, only the first fenced region is stripped, so a
// second fenced region added later would survive and break every
// DB-backed test with a confusing "extension not available" error.

/**
 * Applies the full schema, then every pending migration. Idempotent, and safe to call
 * repeatedly against one shared database (seven test files do).
 *
 * schema.sql is executed ONLY against a database that has never had it. Re-running it
 * puts its `CREATE OR REPLACE` and `DROP POLICY IF EXISTS … ; CREATE POLICY` definitions
 * back over whatever a migration redefined, and applyPending then skips those migrations
 * because they are already recorded, so the suite would pass against a stale schema, and
 * the parity reference database that docs/operations.md builds with `npm test` would be
 * wrong in the same way, making production look like the drifted side.
 *
 * The probe is a schema object, not the baseline history row: migrate.test.ts deletes that
 * row and leaves it deleted, so a row-based check would re-run schema.sql after that file
 * and reintroduce the bug with test-order dependence on top. `monitors` existing proves the
 * whole file committed, because it runs as one multi-statement query (see above) and is
 * therefore all-or-nothing: a failed apply leaves no table behind to mistake for success.
 *
 * The baseline is still recorded on every call, not once, for that same deletion. The
 * destructive guard is deliberately not consulted: this targets a throwaway database and
 * `npm test` must not need MIGRATE_CONFIRM.
 */
export async function applySchema(client: Client): Promise<void> {
  const { rows } = await client.query("SELECT to_regclass('public.monitors') IS NOT NULL AS present");
  if (!rows[0].present) {
    await client.query(
      stripPgCronFence(fs.readFileSync(path.join(__dirname, '../../../supabase/schema.sql'), 'utf8'))
    );
  }
  const dir = path.join(__dirname, '../../../supabase/migrations');
  await recordBaseline(client, dir);
  await applyPending(client, dir, { stripCron: true });
}
