import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Client } from 'pg';
import { getTestClient } from './helpers/db-setup';
import {
  ensureHistoryTable,
  applyPending,
  applyMigration,
  appliedVersions,
  listMigrationFiles,
} from '../../src/db/migrate';

const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('migration runner', () => {
  let client: Client;
  let dir: string;
  const tables: string[] = [];
  const versions: string[] = [];

  // uptimekit_sdd_test persists between runs: unique table names + versions,
  // all removed in afterAll, so nothing assumes an empty database.
  const run = Date.now().toString(36);
  const tbl = (n: string) => {
    const t = `mig_${run}_${n}`;
    tables.push(t);
    return t;
  };
  // Far-future 14-digit versions so they sort after anything real in history.
  let seq = 0;
  const ver = () => {
    const v = `9${run.replace(/\D/g, '').padEnd(5, '0').slice(0, 5)}${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
    versions.push(v);
    return v;
  };
  /** Writes a forward file and its down file into the fixture dir. */
  function write(version: string, name: string, up: string, down: string) {
    fs.writeFileSync(path.join(dir, `${version}_${name}.sql`), up);
    fs.writeFileSync(path.join(dir, 'down', `${version}_${name}.sql`), down);
  }
  const tableExists = async (t: string) =>
    (await client.query('SELECT to_regclass($1) AS r', [`public.${t}`])).rows[0].r !== null;

  beforeAll(async () => {
    client = await getTestClient();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-int-'));
    fs.mkdirSync(path.join(dir, 'down'));
  }, 60_000);

  afterAll(async () => {
    if (client) {
      for (const t of tables) await client.query(`DROP TABLE IF EXISTS public.${t}`);
      await client
        .query('DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY($1)', [versions])
        .catch(() => {}); // history table may not exist if setup failed early
      await client.end();
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ensureHistoryTable creates the CLI-shaped table and is idempotent', async () => {
    await ensureHistoryTable(client);
    await ensureHistoryTable(client);
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'`
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(['name', 'statements', 'version']);
  });

  it('applyPending applies in order and records each version; a second run is a no-op', async () => {
    const [t1, t2] = [tbl('one'), tbl('two')];
    const [v1, v2] = [ver(), ver()];
    write(v1, 'one', `CREATE TABLE public.${t1} (id int);`, `DROP TABLE public.${t1};`);
    write(v2, 'two', `CREATE TABLE public.${t2} (id int);`, `DROP TABLE public.${t2};`);

    const applied = await applyPending(client, dir);
    expect(applied.map((f) => f.version)).toEqual([v1, v2]);
    expect(await tableExists(t1)).toBe(true);
    expect(await tableExists(t2)).toBe(true);
    const history = await appliedVersions(client);
    expect(history).toEqual(expect.arrayContaining([v1, v2]));
    const { rows } = await client.query(
      'SELECT name FROM supabase_migrations.schema_migrations WHERE version = $1',
      [v1]
    );
    expect(rows[0].name).toBe('one');

    const before = (await appliedVersions(client)).length;
    expect(await applyPending(client, dir)).toEqual([]);
    expect((await appliedVersions(client)).length).toBe(before);
  });

  it('a migration that fails partway leaves no schema change and no history row', async () => {
    const t = tbl('ok');
    const v = ver();
    write(v, 'broken', `CREATE TABLE public.${t} (id int);\nTHIS IS NOT SQL;`, `DROP TABLE public.${t};`);

    await expect(applyPending(client, dir)).rejects.toThrow(/syntax error/);
    expect(await tableExists(t)).toBe(false);
    expect(await appliedVersions(client)).not.toContain(v);

    // Clear the broken file so it cannot affect later runs of this suite.
    fs.rmSync(path.join(dir, `${v}_broken.sql`));
    fs.rmSync(path.join(dir, 'down', `${v}_broken.sql`));
  });

  // The case that needs the explicit BEGIN/COMMIT: the migration SQL succeeds,
  // then the history INSERT fails. Without the transaction the DDL stays behind.
  it('rolls back the schema change when the history INSERT fails after the SQL succeeded', async () => {
    const t = tbl('hist');
    const v = ver();
    await client.query('INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1)', [v]);
    write(v, 'dup', `CREATE TABLE public.${t} (id int);`, `DROP TABLE public.${t};`);
    const file = listMigrationFiles(dir).find((f) => f.version === v)!;

    await expect(applyMigration(client, file)).rejects.toThrow(/duplicate key/);
    expect(await tableExists(t)).toBe(false);

    fs.rmSync(file.path);
    fs.rmSync(path.join(dir, 'down', `${v}_dup.sql`));
  });
});
