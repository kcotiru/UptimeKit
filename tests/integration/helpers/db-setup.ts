import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const testDbUrl = process.env.DATABASE_TEST_URL || process.env.DATABASE_URL || '';

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

/** Applies the full schema. Idempotent — every statement is CREATE ... IF NOT EXISTS or OR REPLACE. */
export async function applySchema(client: Client): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/schema.sql'), 'utf8');
  await client.query(sql);
}
