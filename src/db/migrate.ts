import fs from 'fs';
import path from 'path';

// Must be ONE dedicated connection (pg.Client or a checked-out PoolClient), never
// a pg.Pool: BEGIN/COMMIT on a pool land on different connections and silently
// break atomicity. `escapeLiteral` exists on connections but not on Pool, so the type
// rejects a Pool at compile time.
export type Queryable = {
  escapeLiteral(value: string): string;
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export interface MigrationFile {
  /** Leading digits of the filename; '' when the file does not match MIGRATION_FILENAME. */
  version: string;
  /** Text between the underscore and .sql. */
  name: string;
  /** Absolute path to the forward file. */
  path: string;
  downPath: string | null;
}

// Same pattern the Supabase CLI uses, so the two stay interchangeable.
export const MIGRATION_FILENAME = /^([0-9]+)_(.*)\.sql$/;

// Copied verbatim from tests/integration/helpers/db-setup.ts. See the comments
// there for why the fence is explicit sentinels and why the `g` flag matters.
export const PG_CRON_BLOCK =
  /-- @local-test:strip-start \(pg_cron\)[\s\S]*?-- @local-test:strip-end\n?/g;

export function stripPgCronFence(sql: string): string {
  return sql.replace(PG_CRON_BLOCK, '');
}

/**
 * Forward migrations in `dir`, sorted by filename. Every `.sql` file is listed,
 * including ones that break the naming convention (version ''), so that
 * validateMigrationSet can report them instead of silently skipping them.
 * `down/` is not a migration; it only supplies downPath.
 */
export function listMigrationFiles(dir: string): MigrationFile[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort()
    .map((file) => {
      const m = MIGRATION_FILENAME.exec(file);
      const down = path.join(dir, 'down', file);
      return {
        version: m ? m[1] : '',
        name: m ? m[2] : file,
        path: path.join(dir, file),
        downPath: fs.existsSync(down) ? down : null,
      };
    });
}

// Every migration runs inside one transaction, so statements Postgres forbids in
// a transaction block are rejected up front rather than failing cryptically at
// apply time. Supporting them would mean giving up atomicity.
// ponytail: regex over comment-stripped text, not a SQL parser; a keyword inside
// a string literal or function body could false-positive. Upgrade: real tokenizer.
const NON_TRANSACTIONAL: RegExp[] = [
  /\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
  /\bREINDEX\b[^;]*\bCONCURRENTLY\b/i,
  /(?:^|;)\s*VACUUM\b/i,
  /(?:^|;)\s*CLUSTER\b/i,
  /\bALTER\s+SYSTEM\b/i,
];

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

export function validateMigrationSet(files: MigrationFile[], applied: string[]): void {
  const seen = new Map<string, string>();
  for (const f of files) {
    const base = path.basename(f.path);
    if (!MIGRATION_FILENAME.test(base)) {
      throw new Error(`Migration file "${base}" does not match <version>_<name>.sql`);
    }
    const prior = seen.get(f.version);
    if (prior) {
      throw new Error(`duplicate version ${f.version}: "${prior}" and "${base}"`);
    }
    seen.set(f.version, base);
  }

  // 14-digit versions, so lexicographic order is chronological order.
  const newest = applied.reduce((a, b) => (b > a ? b : a), '');
  const done = new Set(applied);
  for (const f of files) {
    const base = path.basename(f.path);
    if (!done.has(f.version) && f.version < newest) {
      throw new Error(
        `Migration "${base}" is out of order: version ${f.version} is older than the newest applied (${newest})`
      );
    }
    const sql = stripComments(fs.readFileSync(f.path, 'utf8'));
    for (const re of NON_TRANSACTIONAL) {
      const hit = re.exec(sql);
      if (hit) {
        throw new Error(
          `Migration "${base}" contains "${hit[0].replace(/^;/, '').trim()}", which cannot run inside a transaction`
        );
      }
    }
  }
}

// Tracking table: exactly the Supabase CLI's shape. Like the CLI, the runner
// compares version strings only and never hashes file contents, so an edit to an
// already-applied migration goes undetected. Deliberate: a hash column would
// make the table CLI-incompatible.
export async function ensureHistoryTable(client: Queryable): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text NOT NULL PRIMARY KEY
    );
    ALTER TABLE supabase_migrations.schema_migrations
      ADD COLUMN IF NOT EXISTS statements text[];
    ALTER TABLE supabase_migrations.schema_migrations
      ADD COLUMN IF NOT EXISTS name text;
  `);
}

export async function appliedVersions(client: Queryable): Promise<string[]> {
  const { rows } = await client.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'
  );
  return rows.map((r) => String(r.version));
}

export async function pendingMigrations(client: Queryable, dir: string): Promise<MigrationFile[]> {
  await ensureHistoryTable(client);
  const applied = await appliedVersions(client);
  const files = listMigrationFiles(dir);
  validateMigrationSet(files, applied);
  const done = new Set(applied);
  return files.filter((f) => !done.has(f.version));
}

/** A migration that cannot be undone says so with a leading "-- irreversible: <reason>". */
export function isIrreversible(sql: string): boolean {
  return /^\s*-- irreversible:[ 	]*\S/.test(sql);
}

/** Every forward file needs a down file or the irreversible marker, so apply never outruns revert. */
export function assertRevertable(files: MigrationFile[]): void {
  for (const f of files) {
    if (!f.downPath && !isIrreversible(fs.readFileSync(f.path, 'utf8'))) {
      throw new Error(
        `Migration "${path.basename(f.path)}" has no down file and is not marked "-- irreversible: <reason>"`
      );
    }
  }
}

/** Runs one migration and records it in one transaction: both commit or neither does. */
export async function applyMigration(
  client: Queryable,
  file: MigrationFile,
  opts: { stripCron?: boolean } = {}
): Promise<void> {
  let sql = fs.readFileSync(file.path, 'utf8');
  if (opts.stripCron) sql = stripPgCronFence(sql);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    // ponytail: the whole file is stored as one "statement"; the CLI splits it.
    await client.query(
      'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
      [file.version, [sql], file.name]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function applyPending(
  client: Queryable,
  dir: string,
  opts: { stripCron?: boolean } = {}
): Promise<MigrationFile[]> {
  const pending = await pendingMigrations(client, dir);
  assertRevertable(pending);
  for (const f of pending) await applyMigration(client, f, opts);
  return pending;
}

/**
 * Reverts the newest applied migration: runs its down file and deletes its history
 * row in one transaction. Newest-first only; walking further back is repetition.
 * Returns null when nothing is applied.
 */
export async function revertLast(
  client: Queryable,
  dir: string,
  opts: { stripCron?: boolean } = {}
): Promise<MigrationFile | null> {
  await ensureHistoryTable(client);
  const newest = (await appliedVersions(client)).pop();
  if (!newest) return null;

  const file = listMigrationFiles(dir).find((f) => f.version === newest);
  if (!file) throw new Error(`Cannot revert ${newest}: no migration file with that version in ${dir}`);
  if (!file.downPath) {
    const why = isIrreversible(fs.readFileSync(file.path, 'utf8')) ? 'is marked irreversible' : 'has no down file';
    throw new Error(`Cannot revert "${path.basename(file.path)}": it ${why}`);
  }

  let sql = fs.readFileSync(file.downPath, 'utf8');
  if (opts.stripCron) sql = stripPgCronFence(sql);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    const { rows } = await client.query(
      'DELETE FROM supabase_migrations.schema_migrations WHERE version = $1 RETURNING version',
      [file.version]
    );
    // Someone else reverted it between our read and now: undo our down file too.
    if (rows.length !== 1) throw new Error(`Cannot revert ${file.version}: no longer in history`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return file;
}

// Version of supabase/migrations/20261020000000_baseline.sql, the comment-only stub
// marking where supabase/schema.sql sits. Single source for that version.
export const BASELINE_VERSION = '20261020000000';

/**
 * Records the baseline as applied WITHOUT running any schema SQL, for databases that
 * already have supabase/schema.sql. Returns false if it was already recorded.
 */
export async function recordBaseline(client: Queryable, dir: string): Promise<boolean> {
  const file = listMigrationFiles(dir).find((f) => f.version === BASELINE_VERSION);
  if (!file) throw new Error(`No baseline migration ${BASELINE_VERSION} in ${dir}`);
  await ensureHistoryTable(client);
  const { rows } = await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
     VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING RETURNING version`,
    [file.version, [], file.name]
  );
  return rows.length === 1;
}
