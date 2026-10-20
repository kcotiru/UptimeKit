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
} from '../../src/db/migrate';

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
  it('removes the fenced region and leaves surrounding SQL', () => {
    const sql = [
      'SELECT 1;',
      '-- @local-test:strip-start (pg_cron)',
      "SELECT cron.schedule('x', '* * * * *', 'select 1');",
      '-- @local-test:strip-end',
      'SELECT 2;',
    ].join('\n');
    const out = stripPgCronFence(sql);
    expect(out).toContain('SELECT 1;');
    expect(out).toContain('SELECT 2;');
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
    'TRUNCATE ping_logs_raw;',
    'DELETE FROM monitors;',
    'select 1; delete from monitors',
  ])('flags %s', (sql) => expect(containsDestructive(sql)).toBe(true));

  it.each([
    'CREATE TABLE t (id int); ALTER TABLE t ADD COLUMN c text;',
    'DELETE FROM monitors WHERE id = 1;',
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
