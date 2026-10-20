import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  BASELINE_VERSION,
  listMigrationFiles,
  validateMigrationSet,
  stripPgCronFence,
  isIrreversible,
  assertRevertable,
  containsDestructive,
  isHostedUrl,
  confirmValueFor,
  resolveTarget,
  sslFor,
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

  it('throws on a version that is not 14 digits, before ordering can be fooled by it', () => {
    // '5' > '20261020000000' as strings, so the out-of-order check below passes this file
    // happily; once applied it is the newest version in history and blocks everything real.
    const dir = fixture({ '5_short.sql': { down: true } });
    expect(() => validateMigrationSet(listMigrationFiles(dir), ['20261020000000'])).toThrow(
      /5_short\.sql.*1-digit/s
    );
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
  /** `applied` is what the history table reports back, so the baseline can be present. */
  function fakeDb(fail?: RegExp, applied: string[] = []) {
    const sent: string[] = [];
    return {
      sent,
      escapeLiteral: (v: string) => `'${v}'`,
      async query(sql: string) {
        sent.push(sql);
        if (fail?.test(sql)) throw new Error('boom');
        const rows = /SELECT version FROM supabase_migrations/i.test(sql)
          ? applied.map((version) => ({ version }))
          : [];
        return { rows: rows as Array<Record<string, unknown>> };
      },
    };
  }
  // A fixture that mirrors the real directory: the baseline stub plus one later migration.
  const withBaseline = () =>
    fixture({
      '20261020000000_baseline.sql': { sql: '-- irreversible: baseline marker\n' },
      '20261101000000_a.sql': { down: true },
    });
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

  it('refuses to apply anything while the baseline is unrecorded, and writes nothing', async () => {
    // The routine deploy command in docs/operations.md is `npm run migrate -- --hosted`.
    // Without this guard that command silently makes the baseline assertion itself: the
    // stub is comment-only, so "applying" it does nothing but insert its history row.
    const db = fakeDb();

    await expect(run(db, withBaseline(), opts(true))).rejects.toThrow(/--baseline-only/);

    expect(db.sent.some((s) => /INSERT INTO supabase_migrations/i.test(s))).toBe(false);
  });

  it('applies migrations once the baseline is recorded', async () => {
    const db = fakeDb(undefined, [BASELINE_VERSION]);

    await run(db, withBaseline(), opts(true));

    // The later migration really was applied, so the guard above is not just refusing everything.
    expect(db.sent).toContain('COMMIT');
    expect(db.sent.some((s) => /INSERT INTO supabase_migrations/i.test(s))).toBe(true);
  });

  it('records no baseline when --baseline-only stops for want of a confirm', async () => {
    // Recording the baseline asserts the database already equals schema.sql, and drift
    // older than that row is undetectable afterwards. A run that refused to proceed must
    // not leave that assertion behind: the operator's next step is the parity audit.
    const dir = fixture({
      '20260101000000_a.sql': { down: true, sql: 'DROP TABLE monitors;' },
      '20261020000000_baseline.sql': { sql: '-- irreversible: baseline marker\n' },
    });
    const db = fakeDb();

    await expect(
      run(db, dir, { args: ['--baseline-only'], hosted: true, confirmed: false, expected: 'ref' })
    ).rejects.toThrow(/destructive/);

    expect(db.sent.some((s) => /INSERT INTO supabase_migrations/i.test(s))).toBe(false);
  });
});

describe('sslFor', () => {
  it('enables TLS for a hosted target', () => {
    expect(sslFor('postgresql://postgres.abcdefgh:pw@aws-0-x.pooler.supabase.com:5432/postgres')).toEqual({
      ssl: { rejectUnauthorized: false },
    });
  });
  it('omits the ssl key entirely for a local target, rather than setting it undefined', () => {
    const opts = sslFor('postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test');
    expect(opts).toEqual({});
    expect('ssl' in opts).toBe(false);
  });

  /**
   * The helper is worthless if a script forgets it: pg connects in plaintext by default,
   * so a missed call site sends the production password over the wire in the clear.
   */
  it('is passed at every connection a script opens for itself', () => {
    const scripts = ['scripts/migrate.ts', 'scripts/audit-schema-parity.ts', 'scripts/seed-dev.ts'];
    let sites = 0;
    for (const file of scripts) {
      const src = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
      const after = src.split('new Client(').slice(1);
      expect(after.length, `no connection found in ${file}`).toBeGreaterThan(0);
      for (const tail of after) expect(tail.slice(0, 200), file).toContain('sslFor(');
      sites += after.length;
    }
    expect(sites).toBe(scripts.length);
  });
});
