import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// No DATABASE_URL fallback, deliberately: in this environment DATABASE_URL
// points at a real production Supabase project, and applySchema()/seed helpers
// run DDL and fixture inserts. A DB-backed test missing its skip guard would
// hit prod instead of failing loudly. A test database must be named explicitly
// via DATABASE_TEST_URL.
const testDbUrl = process.env.DATABASE_TEST_URL || '';

/**
 * Creates and returns an active pg Client connected to test database.
 */
export async function getTestClient(): Promise<Client> {
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
// stopped at cron.schedule()'s closing paren, so anything appended after it —
// such as the cron.job postcondition assertion — silently escaped the strip
// and broke every DB-backed test. tests/integration/partitioning.test.ts
// asserts that no `cron.` reference survives outside the sentinels.
const PG_CRON_BLOCK =
  /-- @local-test:strip-start \(pg_cron\)[\s\S]*?-- @local-test:strip-end\n?/;

/** Applies the full schema. Idempotent — every statement is CREATE ... IF NOT EXISTS or OR REPLACE. */
export async function applySchema(client: Client): Promise<void> {
  const sql = fs
    .readFileSync(path.join(__dirname, '../../../supabase/schema.sql'), 'utf8')
    .replace(PG_CRON_BLOCK, '');
  await client.query(sql);
}
