import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
  revertLast,
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

  it('applyPending refuses a migration with no revert path, before applying anything', async () => {
    const t = tbl('norev');
    const v = ver();
    const prev = dir;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-int-'));
    fs.mkdirSync(path.join(dir, 'down'));
    try {
      fs.writeFileSync(path.join(dir, `${v}_norev.sql`), `CREATE TABLE public.${t} (id int);`);
      await expect(applyPending(client, dir)).rejects.toThrow(/no down file/);
      expect(await tableExists(t)).toBe(false);
      expect(await appliedVersions(client)).not.toContain(v);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = prev;
    }
  });

  describe('revertLast', () => {
    // Fresh dir per test so a leftover file in one test cannot trip another's applyPending.
    let base: string;
    beforeEach(() => {
      base = dir;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-int-'));
      fs.mkdirSync(path.join(dir, 'down'));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = base;
    });

    it('runs the newest down file and removes its history row', async () => {
      const [t1, t2] = [tbl('r1'), tbl('r2')];
      const [v1, v2] = [ver(), ver()];
      write(v1, 'r1', `CREATE TABLE public.${t1} (id int);`, `DROP TABLE public.${t1};`);
      write(v2, 'r2', `CREATE TABLE public.${t2} (id int);`, `DROP TABLE public.${t2};`);
      await applyPending(client, dir);

      const reverted = await revertLast(client, dir);

      expect(reverted?.version).toBe(v2);
      expect(await tableExists(t2)).toBe(false);
      expect(await tableExists(t1)).toBe(true);
      const history = await appliedVersions(client);
      expect(history).toContain(v1);
      expect(history).not.toContain(v2);
    });

    it('returns null when nothing is applied', async () => {
      // Empty the history inside a transaction and roll it back, so the shared
      // test database is left exactly as found. revertLast must not open its own
      // transaction on this path, or it would commit ours.
      await ensureHistoryTable(client);
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM supabase_migrations.schema_migrations');
        expect(await revertLast(client, dir)).toBeNull();
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('refuses when the newest applied migration has no down file, leaving history untouched', async () => {
      const t = tbl('nodown');
      const v = ver();
      fs.writeFileSync(path.join(dir, `${v}_nodown.sql`), `CREATE TABLE public.${t} (id int);`);
      // applyMigration directly: applyPending would (correctly) refuse this file.
      await applyMigration(client, listMigrationFiles(dir)[0]);

      await expect(revertLast(client, dir)).rejects.toThrow(/no down file/);
      expect(await appliedVersions(client)).toContain(v);
      expect(await tableExists(t)).toBe(true);
    });

    it('refuses to run a down file whose forward version is not in dir, leaving history untouched', async () => {
      const t = tbl('orphan');
      const v = ver();
      await client.query(`CREATE TABLE public.${t} (id int)`);
      await client.query('INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1)', [v]);
      // Only the down file exists; its forward file is gone.
      fs.writeFileSync(path.join(dir, 'down', `${v}_orphan.sql`), `DROP TABLE public.${t};`);

      await expect(revertLast(client, dir)).rejects.toThrow(/no migration file/);
      expect(await tableExists(t)).toBe(true);
      expect(await appliedVersions(client)).toContain(v);
    });

    // The case that needs the explicit BEGIN/COMMIT: the down SQL succeeds, then
    // deleting the history row fails. Without the transaction the DDL stays undone.
    it('rolls back the down file when deleting the history row fails', async () => {
      const t = tbl('baddel');
      const v = ver();
      write(v, 'baddel', `CREATE TABLE public.${t} (id int);`, `DROP TABLE public.${t};`);
      await applyPending(client, dir);
      const guard = `mig_${run}_guard`;
      await client.query(`
        CREATE FUNCTION public.${guard}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'delete blocked'; END $$;
        CREATE TRIGGER ${guard} BEFORE DELETE ON supabase_migrations.schema_migrations
          FOR EACH ROW WHEN (OLD.version = '${v}') EXECUTE FUNCTION public.${guard}();`);
      try {
        await expect(revertLast(client, dir)).rejects.toThrow(/delete blocked/);
        expect(await tableExists(t)).toBe(true);
        expect(await appliedVersions(client)).toContain(v);
      } finally {
        await client.query(`DROP TRIGGER ${guard} ON supabase_migrations.schema_migrations`);
        await client.query(`DROP FUNCTION public.${guard}()`);
      }
    });
  });
});
