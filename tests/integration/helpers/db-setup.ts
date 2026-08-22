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
// (pg_available_extensions has no row for it), so
// `CREATE EXTENSION IF NOT EXISTS pg_cron` throws and the rest of schema.sql
// never applies. Strip that whole registration block — from the extension
// line through the closing `);` of the `cron.schedule(...)` call, including
// the `cron.unschedule` DO block in between — by matching on its distinctive
// `$job$` dollar-quote delimiter rather than hardcoded line numbers, since the
// file keeps changing. tests/integration/partitioning.test.ts already covers
// this block at the text level, so it's still exercised, just not executed
// against a live database here.
const PG_CRON_BLOCK =
  /CREATE EXTENSION IF NOT EXISTS pg_cron;[\s\S]*?\$job\$\s*\);\n?/;

/** Applies the full schema. Idempotent — every statement is CREATE ... IF NOT EXISTS or OR REPLACE. */
export async function applySchema(client: Client): Promise<void> {
  const sql = fs
    .readFileSync(path.join(__dirname, '../../../supabase/schema.sql'), 'utf8')
    .replace(PG_CRON_BLOCK, '');
  await client.query(sql);
}
