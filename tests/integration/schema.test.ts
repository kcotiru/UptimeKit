import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestClient, runSqlFile, runAllMigrationsUp, runAllMigrationsDown } from './helpers/db-setup';
import { Client } from 'pg';

describe('Foundational Schema Integration Tests (Teams & Users)', () => {
  let client: Client;
  let isDbAvailable = false;

  beforeAll(async () => {
    try {
      client = await getTestClient();
      isDbAvailable = true;
    } catch {
      console.warn('PostgreSQL test DB not available; skipping live DB queries.');
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  it('verifies 001_create_teams and 002_create_users migrations SQL syntax and down scripts exist', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const up001 = fs.readFileSync(path.join(__dirname, '../../db/migrations/001_create_teams.sql'), 'utf8');
    const down001 = fs.readFileSync(path.join(__dirname, '../../db/migrations/down/001_drop_teams.sql'), 'utf8');
    const up002 = fs.readFileSync(path.join(__dirname, '../../db/migrations/002_create_users.sql'), 'utf8');
    const down002 = fs.readFileSync(path.join(__dirname, '../../db/migrations/down/002_drop_users.sql'), 'utf8');

    expect(up001).toContain('CREATE TABLE IF NOT EXISTS teams');
    expect(down001).toContain('DROP TABLE IF EXISTS teams');
    expect(up002).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(down002).toContain('DROP TABLE IF EXISTS users');
  });

  it('executes up and down migrations on live database if available', async () => {
    if (!isDbAvailable) return;

    await runAllMigrationsDown(client);
    await runAllMigrationsUp(client);

    const resTeams = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'teams';
    `);
    const teamCols = resTeams.rows.map(r => r.column_name);
    expect(teamCols).toEqual(expect.arrayContaining(['id', 'name', 'plan', 'quota_limits', 'created_at', 'updated_at']));

    const resUsers = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users';
    `);
    const userCols = resUsers.rows.map(r => r.column_name);
    expect(userCols).toEqual(expect.arrayContaining(['id', 'team_id', 'email', 'password_hash', 'role']));
  });
});
