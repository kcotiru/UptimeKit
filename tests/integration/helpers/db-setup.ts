import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const testDbUrl = process.env.DATABASE_TEST_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/uptimekit_test';

/**
 * Creates and returns an active pg Client connected to test database.
 */
export async function getTestClient(): Promise<Client> {
  const client = new Client({ connectionString: testDbUrl });
  await client.connect();
  return client;
}

/**
 * Executes a migration SQL file by relative migration path.
 */
export async function runSqlFile(client: Client, relativePath: string): Promise<void> {
  const fullPath = path.join(__dirname, '../../../db/migrations', relativePath);
  const sql = fs.readFileSync(fullPath, 'utf8');
  await client.query(sql);
}

/**
 * Runs all forward migrations in numbered order.
 */
export async function runAllMigrationsUp(client: Client): Promise<void> {
  const migrationsDir = path.join(__dirname, '../../../db/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.startsWith('down'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await client.query(sql);
  }
}

/**
 * Runs all reverse migrations in reverse numbered order.
 */
export async function runAllMigrationsDown(client: Client): Promise<void> {
  const downDir = path.join(__dirname, '../../../db/migrations/down');
  if (!fs.existsSync(downDir)) return;

  const files = fs.readdirSync(downDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .reverse();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(downDir, file), 'utf8');
    await client.query(sql);
  }
}
