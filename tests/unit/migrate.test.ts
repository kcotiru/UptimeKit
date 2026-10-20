import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listMigrationFiles,
  validateMigrationSet,
  stripPgCronFence,
  isIrreversible,
  assertRevertable,
  containsDestructive,
  isHostedUrl,
  confirmValueFor,
  resolveTarget,
} from '../../src/db/migrate';
import { rejectUnknownFlags, run } from '../../scripts/migrate';

const dirs: string[] = [];
/** Temp migrations dir; each entry gets a forward file, plus a down file when `down` is set. */
function fixture(files: Record<string, { down?: boolean; sql?: string }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-unit-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'down'));
  for (const [name, { down, sql }] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql ?? 'SELECT 1;');
    if (down) fs.writeFileSync(path.join(dir, 'down', name), 'SELECT 1;');
  }
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('listMigrationFiles', () => {
  it('parses version and name, sorted by filename', () => {
    const dir = fixture({
      '20260102000000_b.sql': { down: true },
      '20260101000000_a.sql': { down: true },
    });
    const files = listMigrationFiles(dir);
    expect(files.map((f) => [f.version, f.name])).toEqual([
      ['20260101000000', 'a'],
      ['20260102000000', 'b'],
    ]);
    expect(files[0].path).toBe(path.join(dir, '20260101000000_a.sql'));
  });

  it('finds a down file in down/ with the same basename', () => {
    const dir = fixture({
      '20260101000000_a.sql': { down: true },
      '20260102000000_b.sql': {},
    });
    const [a, b] = listMigrationFiles(dir);
    expect(a.downPath).toBe(path.join(dir, 'down', '20260101000000_a.sql'));
    expect(b.downPath).toBeNull();
  });
});

describe('validateMigrationSet', () => {
  it('throws on two files sharing a version', () => {
    const dir = fixture({
      '20260101000000_a.sql': { down: true },
      '20260101000000_b.sql': { down: true },
    });
    expect(() => validateMigrationSet(listMigrationFiles(dir), [])).toThrow(/duplicate version/);
  });

  it('throws on a file not matching the naming convention, naming it', () => {
    const dir = fixture({ 'oops.sql': { down: true } });
    expect(() => validateMigrationSet(listMigrationFiles(dir), [])).toThrow(/oops\.sql/);
  });

  it('throws when a pending file is older than the newest applied', () => {
    const dir = fixture({ '20260101000000_late.sql': { down: true } });
    expect(() => validateMigrationSet(listMigrationFiles(dir), ['20260105000000'])).toThrow(
      /20260101000000_late.sql.*out of order/
    );
  });

  it('accepts an already-applied file older than the newest applied', () => {
    const dir = fixture({ '20260101000000_a.sql': { down: true } });
    expect(() =>
      validateMigrationSet(listMigrationFiles(dir), ['20260101000000', '20260105000000'])
    ).not.toThrow();
  });

  it.each([
    'CREATE INDEX CONCURRENTLY i ON t (c);',
    'reindex index concurrently i;',
    'VACUUM t;',
    'CLUSTER t;',
    "ALTER SYSTEM SET work_mem = '8MB';",
    // applyMigration owns the transaction: a file's own COMMIT would end it early and
    // leave the history INSERT auto-committed on its own, so the DDL survives its failure.
    'BEGIN;\nALTER TABLE t ADD COLUMN c text;\nCOMMIT;',
    'ALTER TABLE t ADD COLUMN c text;\nCOMMIT;',
    'SAVEPOINT s;',
  ])('rejects a statement that cannot run inside a transaction: %s', (sql) => {
    const dir = fixture({ '20260101000000_a.sql': { down: true, sql } });
    expect(() => validateMigrationSet(listMigrationFiles(dir), [])).toThrow(
      /20260101000000_a\.sql.*transaction/s
    );
  });

  it('ignores a forbidden keyword that only appears in a comment', () => {
    const dir = fixture({
      '20260101000000_a.sql': { down: true, sql: '-- do not VACUUM here\nSELECT 1;' },
    });
    expect(() => validateMigrationSet(listMigrationFiles(dir), [])).not.toThrow();
  });
});

describe('stripPgCronFence', () => {
  // Two fenced blocks, not one: PG_CRON_BLOCK needs the /g flag, and a single block
  // passes with or without it. A dropped `g` previously broke every DB-backed test.
  it('removes every fenced region and leaves surrounding SQL', () => {
    const sql = [
      'SELECT 1;',
      '-- @local-test:strip-start (pg_cron)',
      "SELECT cron.schedule('x', '* * * * *', 'select 1');",
      '-- @local-test:strip-end',
      'SELECT 2;',
      '-- @local-test:strip-start (pg_cron)',
      "SELECT cron.unschedule('x');",
      '-- @local-test:strip-end',
      'SELECT 3;',
    ].join('\n');
    const out = stripPgCronFence(sql);
    expect(out).toContain('SELECT 1;');
    expect(out).toContain('SELECT 2;');
    expect(out).toContain('SELECT 3;');
    expect(out).not.toContain('cron');
  });
});

describe('isIrreversible', () => {
  it('detects a leading "-- irreversible:" marker', () => {
    expect(isIrreversible('-- irreversible: drops data\nDROP TABLE t;')).toBe(true);
    expect(isIrreversible('\n  -- irreversible: drops data\nDROP TABLE t;')).toBe(true);
    expect(isIrreversible('SELECT 1;\n-- irreversible: not leading')).toBe(false);
    expect(isIrreversible('-- irreversible:\nSELECT 1;')).toBe(false); // no reason given
    expect(isIrreversible('SELECT 1;')).toBe(false);
  });
});

describe('assertRevertable', () => {
  it('throws naming a forward file that has no down file and no marker', () => {
    const dir = fixture({
      '20260101000000_a.sql': { down: true },
      '20260102000000_b.sql': {},
    });
    expect(() => assertRevertable(listMigrationFiles(dir))).toThrow(/20260102000000_b\.sql/);
  });

  it('accepts a file marked irreversible with a reason', () => {
    const dir = fixture({
      '20260101000000_a.sql': { sql: '-- irreversible: drops a column\nALTER TABLE t DROP COLUMN c;' },
    });
    expect(() => assertRevertable(listMigrationFiles(dir))).not.toThrow();
  });
});

describe('containsDestructive', () => {
  it.each([
    'DROP TABLE monitors;',
    'ALTER TABLE monitors DROP COLUMN url;',
    'ALTER TABLE monitors DROP CONSTRAINT c;',
    'DROP SCHEMA app CASCADE;',
    'DROP MATERIALIZED VIEW daily_rollups;',
    'ALTER TABLE monitors DISABLE ROW LEVEL SECURITY;',
    'TRUNCATE ping_logs_raw;',
    'DELETE FROM monitors;',
    'select 1; delete from monitors',
  ])('flags %s', (sql) => expect(containsDestructive(sql)).toBe(true));

  it.each([
    'CREATE TABLE t (id int); ALTER TABLE t ADD COLUMN c text;',
    'DELETE FROM monitors WHERE id = 1;',
    'DROP POLICY IF EXISTS p ON monitors; CREATE POLICY p ON monitors USING (true);',
    '-- DROP TABLE monitors;\n/* TRUNCATE x */ SELECT 1;',
  ])('does not flag %s', (sql) => expect(containsDestructive(sql)).toBe(false));
});

describe('confirmValueFor / isHostedUrl', () => {
  const pooler = 'postgresql://postgres.abcdefgh:pw@aws-0-x.pooler.supabase.com:5432/postgres';
  const local = 'postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test';

  it('returns the project ref for a Supabase pooler URL, not "postgres"', () => {
    expect(confirmValueFor(pooler)).toBe('abcdefgh');
  });
  it('returns the project ref for a direct Supabase URL', () => {
    expect(confirmValueFor('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres')).toBe('abcdefgh');
  });
  it('returns the database name for a local URL', () => {
    expect(confirmValueFor(local)).toBe('uptimekit_sdd_test');
  });
  it('distinguishes a Supabase host from localhost', () => {
    expect(isHostedUrl(pooler)).toBe(true);
    expect(isHostedUrl(local)).toBe(false);
    expect(isHostedUrl('postgresql://u:p@notsupabase.com/db')).toBe(false);
  });
});

describe('resolveTarget', () => {
  const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test';
  const PROD = 'postgresql://postgres.abcdefgh:pw@aws-0-x.pooler.supabase.com:5432/postgres';
  const env = { DATABASE_TEST_URL: LOCAL, DATABASE_URL: PROD };

  it('no flags targets DATABASE_TEST_URL', () => {
    expect(resolveTarget([], env)).toMatchObject({ url: LOCAL, expected: 'uptimekit_sdd_test', hosted: false });
  });
  it('--db-url targets that URL', () => {
    const other = 'postgresql://u:p@127.0.0.1/other';
    expect(resolveTarget(['--db-url', other], env)).toMatchObject({ url: other, expected: 'other' });
  });
  it('--hosted targets DATABASE_URL when confirmed with the project ref', () => {
    expect(resolveTarget(['--hosted'], { ...env, MIGRATE_CONFIRM: 'abcdefgh' })).toMatchObject({
      url: PROD, expected: 'abcdefgh', hosted: true, confirmed: true,
    });
  });
  it('--baseline-only and --down keep the DATABASE_TEST_URL target', () => {
    expect(resolveTarget(['--baseline-only'], env).url).toBe(LOCAL);
    expect(resolveTarget(['--down'], env).url).toBe(LOCAL);
  });
  it('refuses when there is no target and never falls back to DATABASE_URL', () => {
    expect(() => resolveTarget([], { DATABASE_URL: PROD })).toThrow(/No target/);
    expect(() => resolveTarget([], { DATABASE_TEST_URL: '', DATABASE_URL: PROD })).toThrow(/No target/);
  });
  it('refuses --hosted without the project-ref confirm, or with the database name', () => {
    expect(() => resolveTarget(['--hosted'], env)).toThrow(/MIGRATE_CONFIRM=abcdefgh/);
    expect(() => resolveTarget(['--hosted'], { ...env, MIGRATE_CONFIRM: 'postgres' })).toThrow(/MIGRATE_CONFIRM=abcdefgh/);
  });
  it('refuses --hosted without DATABASE_URL, and --hosted with --db-url', () => {
    expect(() => resolveTarget(['--hosted'], { DATABASE_TEST_URL: LOCAL })).toThrow(/DATABASE_URL is not set/);
    expect(() => resolveTarget(['--hosted', '--db-url', LOCAL], env)).toThrow(/mutually exclusive/);
  });
  it('requires the confirm when DATABASE_TEST_URL itself points at a Supabase host', () => {
    expect(() => resolveTarget([], { DATABASE_TEST_URL: PROD })).toThrow(/MIGRATE_CONFIRM=abcdefgh/);
  });
  it('refuses --hosted when DATABASE_URL is not a recognised Supabase host', () => {
    expect(() => resolveTarget(['--hosted'], { DATABASE_URL: LOCAL, MIGRATE_CONFIRM: 'uptimekit_sdd_test' })).toThrow(/not a recognised Supabase host/);
  });
});

describe('rejectUnknownFlags', () => {
  it('accepts the known flags and a --db-url value', () => {
    expect(() => rejectUnknownFlags(['--down'])).not.toThrow();
    expect(() => rejectUnknownFlags(['--hosted', '--baseline-only'])).not.toThrow();
    expect(() => rejectUnknownFlags(['--db-url', 'postgresql://u:p@127.0.0.1/db'])).not.toThrow();
  });
  it('names a typo instead of silently falling through to the default target', () => {
    expect(() => rejectUnknownFlags(['--hostd'])).toThrow(/Unknown flag: --hostd/);
    expect(() => rejectUnknownFlags(['--dwon', '--baselineonly'])).toThrow(/--dwon, --baselineonly/);
  });
});

// The NOTIFY gate is the only untested branch on the code path that exclusively touches
// production, and it needs no hosted connection: `hosted` is a boolean and NOTIFY is a
// query string. A fake Queryable covers it.
describe('run (CLI body)', () => {
  function fakeDb(fail?: RegExp) {
    const sent: string[] = [];
    return {
      sent,
      escapeLiteral: (v: string) => `'${v}'`,
      async query(sql: string) {
        sent.push(sql);
        if (fail?.test(sql)) throw new Error('boom');
        return { rows: [] as Array<Record<string, unknown>> };
      },
    };
  }
  const NOTIFY = "NOTIFY pgrst, 'reload schema'";
  const opts = (hosted: boolean) => ({ args: [], hosted, confirmed: true, expected: 'ref' });

  it('notifies PostgREST after a partial apply against a hosted target', async () => {
    const dir = fixture({
      '20260101000000_a.sql': { down: true },
      '20260102000000_b.sql': { down: true, sql: 'BOOM;' },
    });
    const db = fakeDb(/BOOM/);

    await expect(run(db, dir, opts(true))).rejects.toThrow(/boom/);

    // The first migration really did commit, so this is the partial-apply case.
    expect(db.sent).toContain('COMMIT');
    expect(db.sent).toContain(NOTIFY);
    expect(db.sent.indexOf('COMMIT')).toBeLessThan(db.sent.indexOf(NOTIFY));
  });

  it('does not notify when the target is not hosted', async () => {
    const dir = fixture({ '20260101000000_a.sql': { down: true } });
    const db = fakeDb();
    await run(db, dir, opts(false));
    expect(db.sent).toContain('COMMIT');
    expect(db.sent).not.toContain(NOTIFY);
  });

  it('does not notify a hosted target when nothing changed', async () => {
    const db = fakeDb();
    await run(db, fixture({}), opts(true));
    expect(db.sent).not.toContain(NOTIFY);
  });
});
