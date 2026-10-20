import fs from 'fs';
import path from 'path';

// Must be ONE dedicated connection (pg.Client or a checked-out PoolClient), never
// a pg.Pool: BEGIN/COMMIT on a pool land on different connections and silently
// break atomicity. `escapeLiteral` exists on connections but not on Pool, so the type
// rejects a Pool at compile time.
export type Queryable = {
  /**
   * Never called. It is here only as a structural discriminator: Client and PoolClient
   * declare it, Pool does not, so a Pool fails to type-check.
   * ponytail: a proxy for "one dedicated connection", not enforcement of it. It rides on
   * @types/pg's current shape, `pool as any` still slips through, and every test fake has
   * to implement it. Upgrade: a branded type the connection helpers hand out.
   */
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
// a string literal or function body could false-positive. The transaction-control
// entry trips on a plpgsql body written `DECLARE v int; BEGIN …`, since the `;`
// before BEGIN looks like a statement boundary — write such a body with no DECLARE
// block, or inline the declaration, until this grows a tokenizer.
const NON_TRANSACTIONAL: RegExp[] = [
  /\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
  /\bREINDEX\b[^;]*\bCONCURRENTLY\b/i,
  /(?:^|;)\s*VACUUM\b/i,
  /(?:^|;)\s*CLUSTER\b/i,
  /\bALTER\s+SYSTEM\b/i,
  // applyMigration owns the transaction. A file that opens its own voids that
  // silently: Postgres ignores the nested BEGIN with a warning, the file's COMMIT
  // ends the runner's transaction, and the history INSERT then runs alone and
  // auto-committed — so if it fails, the DDL is already committed. schema.sql:6
  // tells the operator to wrap *that* file in BEGIN/COMMIT, so the pattern is in
  // the repo waiting to be copied into a migration.
  /(?:^|;)\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)\b/i,
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
          `Migration "${base}" contains "${hit[0].replace(/^;/, '').trim()}", which cannot run inside ` +
            `the transaction the runner opens for every migration`
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

/** Newest applied version, or null. The one definition shared by revertLast and the CLI guard. */
export async function newestApplied(client: Queryable): Promise<string | null> {
  await ensureHistoryTable(client);
  return (await appliedVersions(client)).pop() ?? null;
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
  const newest = await newestApplied(client);
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

// Destructive-statement scan for the CLI guard.
// ponytail: regex over comment-stripped text, a heuristic and NOT a guarantee. It
// FAILS OPEN as well as closed, so it must never be described as a safety net:
//   - fail-closed: it false-positives on DROP/DELETE inside a string literal or a
//     dollar-quoted body, and asks for a confirm that was not needed.
//   - FAIL-OPEN: stripComments() treats `--` as a line comment *even inside a string
//     literal*, so everything after it on that line disappears before the scan sees it.
//     `INSERT INTO notes VALUES ('a--b'); DROP TABLE old;` on one line is reported clean.
//   - FAIL-OPEN: dynamic SQL defeats it entirely (EXECUTE inside a DO block).
// Upgrade: a real SQL parser; nothing short of one closes the fail-open direction.
// Scope: drops (TABLE/COLUMN/SCHEMA/DATABASE/VIEW/MATERIALIZED VIEW/TYPE and
// `ALTER … DROP`), TRUNCATE, a DELETE with no WHERE, and DISABLE ROW LEVEL SECURITY
// (it exposes every tenant's rows to PostgREST's non-owner roles and no legitimate
// migration contains it). Plenty of data loss falls outside that list and is NOT
// flagged: `UPDATE … SET col = NULL`, a lossy `ALTER COLUMN … TYPE`, `DROP INDEX`.
// It does not cover authorization changes in general either: DROP POLICY / FUNCTION /
// TRIGGER are deliberately unflagged, since "DROP POLICY IF EXISTS x; CREATE POLICY x"
// is the idiom schema.sql uses.
export function containsDestructive(sql: string): boolean {
  return stripComments(sql)
    .split(';')
    .some(
      (s) =>
        /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE|(?:MATERIALIZED\s+)?VIEW|TYPE)\b/i.test(s) ||
        /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(s) ||
        /\bTRUNCATE\b/i.test(s) ||
        /\bALTER\b[\s\S]*\bDROP\b/i.test(s) ||
        (/\bDELETE\s+FROM\b/i.test(s) && !/\bWHERE\b/i.test(s))
    );
}

/** True for any Supabase host (pooler `*.pooler.supabase.com` or direct `db.<ref>.supabase.co`). */
export function isHostedUrl(url: string): boolean {
  return /(?:^|\.)supabase\.(?:com|co)$/i.test(new URL(url).hostname);
}

/**
 * Connection options for a target, spread into a `pg` config. node-postgres connects in
 * plaintext unless told otherwise and Supabase URLs carry no `sslmode`, so without this
 * the password and every statement cross the internet in the clear. Supabase requires TLS;
 * its cert chain is not in the local trust store. A local Postgres has no certificate at
 * all, so it gets no `ssl` key rather than an explicit `undefined` — that would override
 * an `sslmode` the caller put in the URL itself.
 */
export function sslFor(url: string): { ssl?: { rejectUnauthorized: boolean } } {
  return isHostedUrl(url) ? { ssl: { rejectUnauthorized: false } } : {};
}

/**
 * What MIGRATE_CONFIRM must equal for this target: the project ref when hosted, else the
 * database name. Never the database name for a hosted URL: it is always `postgres`.
 */
export function confirmValueFor(url: string): string {
  const u = new URL(url);
  if (!isHostedUrl(url)) return decodeURIComponent(u.pathname.slice(1));
  const ref =
    /^postgres\.(.+)$/.exec(decodeURIComponent(u.username))?.[1] ??
    /^db\.([^.]+)\.supabase\.co$/i.exec(u.hostname)?.[1];
  if (!ref) throw new Error('Cannot derive a Supabase project ref from this URL');
  return ref;
}

/**
 * Pure target selection and safety gate for the CLI; opens no connection. Throws, before
 * any connection could exist, when there is no target, or the target is hosted and
 * MIGRATE_CONFIRM is not its project ref. DATABASE_TEST_URL never falls back to DATABASE_URL.
 */
export function resolveTarget(
  args: string[],
  env: Record<string, string | undefined>
): { url: string; expected: string; hosted: boolean; confirmed: boolean } {
  const wantHosted = args.includes('--hosted');
  const i = args.indexOf('--db-url');
  const explicit = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && !explicit) throw new Error('--db-url needs a value');
  if (explicit && wantHosted) throw new Error('--db-url and --hosted are mutually exclusive');

  const url = wantHosted ? env.DATABASE_URL : (explicit ?? env.DATABASE_TEST_URL);
  if (!url) {
    throw new Error(
      wantHosted
        ? 'DATABASE_URL is not set'
        : 'No target: set DATABASE_TEST_URL or pass --db-url <url> (or --hosted)'
    );
  }
  const hosted = isHostedUrl(url);
  // Otherwise the confirm degrades to the database name and the cron fence/NOTIFY are mishandled.
  if (wantHosted && !hosted) throw new Error('DATABASE_URL is not a recognised Supabase host; refusing');

  const expected = confirmValueFor(url);
  const confirmed = env.MIGRATE_CONFIRM === expected;
  if (hosted && !confirmed) {
    throw new Error(
      `Refusing to touch a hosted database. Re-run with MIGRATE_CONFIRM=${expected} ` +
        `once you are sure the target is the one you intend.`
    );
  }
  return { url, expected, hosted, confirmed };
}
