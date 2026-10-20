# Migration Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-pasting `supabase/schema.sql` with a runner that applies ordered migration files, records what it applied, and can unwind the most recent one.

**Architecture:** `schema.sql` freezes as the baseline. A pure core (`src/db/migrate.ts`) does discovery, tracking and apply/revert against any `pg` connection; a CLI wrapper (`scripts/migrate.ts`) owns target selection and the destructive-statement guard. Tracking lives in `supabase_migrations.schema_migrations` in the Supabase CLI's exact format, so adopting the CLI later stays possible. The test harness reuses the core so database-backed tests never run against a stale schema.

**Tech Stack:** TypeScript, Node 22+, `pg@^8.12.0` (already a dependency), vitest, ts-node.

**Spec:** `docs/superpowers/specs/2026-10-18-migration-runner-design.md`

## Global Constraints

- **No new runtime dependencies.** `pg@^8.12.0` is already present; nothing else may be added.
- **Node >= 22** (`package.json` engines).
- **`supabase/schema.sql` must not move, split, or stop being re-runnable.** `tests/integration/tier-columns.test.ts:199-202` applies it twice and asserts both succeed.
- **Database-backed tests skip, never fail,** when `DATABASE_TEST_URL` is absent.
- **`DATABASE_TEST_URL` never falls back to `DATABASE_URL`.** Rule established at `tests/integration/helpers/db-setup.ts:8-13`.
- **The pg_cron fence** `-- @local-test:strip-start (pg_cron)` / `-- @local-test:strip-end` must be stripped by anything applying SQL to a local Postgres.
- **Tracking table matches the CLI exactly:** `supabase_migrations.schema_migrations`, `version text NOT NULL PRIMARY KEY`, plus `statements text[]` and `name text`. Version strings only — never hash file contents.
- **Migration filenames match `^([0-9]+)_(.*)\.sql$`,** version being a 14-digit UTC `YYYYMMDDHHMMSS`.
- **`vitest.config.ts:23` sets `fileParallelism: false`.** Do not change it; concurrent `applySchema` calls deadlock on `pg_proc`.
- **Never connect to `DATABASE_URL`** during development or testing. It points at a live production project.

## Review Focus

Five failure modes the spec implies that no task's happy path exercises. Each has its test assigned to the task that owns the code.

1. **A migration whose SQL fails partway** must leave neither a partial schema nor a history row — otherwise a failed run is recorded as success. (Task 1)
2. **Two files sharing a version** must be rejected, not applied in filesystem order, which is nondeterministic across platforms. (Task 1)
3. **A new file with a version older than the newest applied** must be rejected loudly, not silently skipped — a silently skipped migration is a missing schema change nobody notices. (Task 1)
4. **No target configured** must refuse to run rather than fall through to any default, since the only other connection string in the environment is production. (Task 4)
5. **Revert with no down file, or a down file whose forward migration was never applied,** must refuse rather than execute arbitrary SQL. (Task 2)

---

## File Structure

**Create:**
- `src/db/migrate.ts` — the core. Pure functions plus apply/revert against a passed-in connection. No module-level side effects, no env reads, no Redis, so both the CLI and the test harness can import it.
- `scripts/migrate.ts` — CLI entry point: argument parsing, target selection, the destructive guard, `NOTIFY pgrst`.
- `scripts/audit-schema-parity.ts` — one-off read-only comparison of two databases' catalogs.
- `supabase/migrations/<timestamp>_baseline.sql` — the baseline stub.
- `supabase/migrations/README.md` — authoring rules and documented ceilings.
- `tests/unit/migrate.test.ts` — the pure functions. Runs with no database.
- `tests/integration/migrate.test.ts` — apply/revert against `DATABASE_TEST_URL`.

**Modify:**
- `tests/integration/helpers/db-setup.ts` — `applySchema()` also applies pending migrations; the pg_cron regex moves to `src/db/migrate.ts` and is imported from there.
- `tests/integration/partitioning.test.ts` — fence invariant extended over `supabase/migrations/`.
- `package.json` — `migrate`, `migrate:down`, `audit:parity` scripts.
- `README.md:112` and `README.md:198`, `docs/operations.md`, `docs/setup.md`, `docs/known-issues.md`.

---

### Task 1: Core — discovery, tracking, apply

**Files:**
- Create: `src/db/migrate.ts`
- Create: `tests/unit/migrate.test.ts`
- Create: `tests/integration/migrate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export interface MigrationFile {
  version: string;        // leading digits
  name: string;           // text between the underscore and .sql
  path: string;           // absolute path to the forward file
  downPath: string | null;
}

export const MIGRATION_FILENAME: RegExp;          // ^([0-9]+)_(.*)\.sql$
export const PG_CRON_BLOCK: RegExp;               // moved here from db-setup.ts
export function stripPgCronFence(sql: string): string;
export function listMigrationFiles(dir: string): MigrationFile[];
export function validateMigrationSet(files: MigrationFile[], applied: string[]): void;
export async function ensureHistoryTable(client: Queryable): Promise<void>;
export async function appliedVersions(client: Queryable): Promise<string[]>;
export async function pendingMigrations(client: Queryable, dir: string): Promise<MigrationFile[]>;
export async function applyMigration(client: Queryable, file: MigrationFile, opts?: { stripCron?: boolean }): Promise<void>;
export async function applyPending(client: Queryable, dir: string, opts?: { stripCron?: boolean }): Promise<MigrationFile[]>;
```

`listMigrationFiles` sorts by filename and ignores `down/`. A file not matching `MIGRATION_FILENAME` is not silently skipped — it is reported by `validateMigrationSet`.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/migrate.test.ts`, using a temp fixture directory per test (`fs.mkdtempSync`):

```ts
test('listMigrationFiles parses version and name, sorted by filename', …)
  // 20260101000000_a.sql, 20260102000000_b.sql -> versions in that order

test('listMigrationFiles finds a down file in down/ with the same basename', …)
  // downPath is non-null for the file that has one, null for the one that does not

test('validateMigrationSet throws on two files sharing a version', …)
  // 20260101000000_a.sql + 20260101000000_b.sql -> /duplicate version/

test('validateMigrationSet throws on a file not matching the naming convention', …)
  // "oops.sql" -> error naming the file, NOT a silent skip

test('validateMigrationSet throws when a pending file is older than the newest applied', …)
  // applied ['20260105000000'], local file '20260101000000_late.sql' -> /out of order/

test('validateMigrationSet rejects a statement that cannot run inside a transaction', …)
  // CREATE INDEX CONCURRENTLY / REINDEX .. CONCURRENTLY / VACUUM / CLUSTER /
  // ALTER SYSTEM -> error naming the file and the statement

test('stripPgCronFence removes the fenced region and leaves surrounding SQL', …)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: FAIL — cannot resolve `src/db/migrate`.

- [ ] **Step 3: Implement the pure functions** in `src/db/migrate.ts`

`MIGRATION_FILENAME` and the 14-digit convention are fixed by the Global Constraints. Copy `PG_CRON_BLOCK` verbatim from `tests/integration/helpers/db-setup.ts:50-51` rather than rewriting the regex. `validateMigrationSet` raises on the four conditions above, each with a message naming the offending file.

On the last one: because every migration is applied inside a transaction, a statement Postgres forbids in a transaction block cannot be supported without giving up atomicity. The spec leaves the choice open and notes rejecting is the smaller change — so reject, with an error that names the statement rather than letting Postgres fail cryptically at apply time. Supporting them can be revisited if a real migration ever needs one.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing integration tests** in `tests/integration/migrate.test.ts`, wrapped in the repo's standard skip guard on `DATABASE_TEST_URL` and using `getTestClient()` from `./helpers/db-setup`:

```ts
test('ensureHistoryTable creates the CLI-shaped table and is idempotent', …)
  // run twice; assert columns version/statements/name exist in supabase_migrations.schema_migrations

test('applyPending applies in order and records each version', …)
  // two fixture migrations creating temp tables -> both tables exist, both versions in history

test('a second applyPending run is a no-op', …)
  // returns [] and history row count is unchanged

test('a migration that fails partway leaves no schema change and no history row', …)
  // fixture: CREATE TABLE t_ok; then a deliberate syntax error
  // assert: t_ok does NOT exist, and its version is NOT in history
```

The last one is Review Focus item 1 and is the reason apply is transactional.

- [ ] **Step 6: Run them to verify they fail**

Run: `npm run test:integration -- tests/integration/migrate.test.ts`
Expected: FAIL (or skip if no `DATABASE_TEST_URL` — configure one before continuing; this task cannot be verified without it).

- [ ] **Step 7: Implement `ensureHistoryTable`, `appliedVersions`, `pendingMigrations`, `applyMigration`, `applyPending`**

`ensureHistoryTable` issues the exact DDL from the spec's Tracking table section. `applyMigration` wraps the file and its history `INSERT` in one `BEGIN`/`COMMIT` so they commit or fail together, populating `statements` with the file's statements and `name` from the filename. `applyPending` calls `validateMigrationSet` before applying anything.

- [ ] **Step 8: Run the integration tests to verify they pass**

Run: `npm run test:integration -- tests/integration/migrate.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/db/migrate.ts tests/unit/migrate.test.ts tests/integration/migrate.test.ts
git commit -m "feat(db): migration discovery, tracking table and transactional apply"
```

---

### Task 2: Revert, newest-first

**Files:**
- Modify: `src/db/migrate.ts`
- Modify: `tests/unit/migrate.test.ts`
- Modify: `tests/integration/migrate.test.ts`

**Interfaces:**
- Consumes: Task 1's `MigrationFile`, `Queryable`, `appliedVersions`, `listMigrationFiles`.
- Produces:

```ts
export function isIrreversible(sql: string): boolean;              // leading "-- irreversible:" marker
export function assertRevertable(files: MigrationFile[]): void;     // throws if a forward file has neither a down file nor the marker
export async function revertLast(client: Queryable, dir: string, opts?: { stripCron?: boolean }): Promise<MigrationFile | null>;
```

`revertLast` reads the highest applied version, runs its down file, and deletes that history row **in one transaction**. It takes no target version: walking further back is repetition. It returns `null` when history is empty.

- [ ] **Step 1: Write the failing unit tests**

```ts
test('isIrreversible detects a leading "-- irreversible:" marker', …)
test('assertRevertable throws naming a forward file that has no down file and no marker', …)
test('assertRevertable accepts a file marked irreversible with a reason', …)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: FAIL — `isIrreversible` is not exported.

- [ ] **Step 3: Implement `isIrreversible` and `assertRevertable`** in `src/db/migrate.ts`

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing integration tests**

```ts
test('revertLast runs the newest down file and removes its history row', …)
  // apply two migrations, revert once -> second table gone, first intact, one version left

test('revertLast returns null when nothing is applied', …)

test('revertLast refuses when the newest applied migration has no down file', …)
  // Review Focus item 5: throws, and the history row is left untouched

test('revertLast refuses to run a down file whose forward version is not in history', …)
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm run test:integration -- tests/integration/migrate.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement `revertLast`** in `src/db/migrate.ts`, and call `assertRevertable` from `applyPending` so a migration with no revert path cannot be applied in the first place

- [ ] **Step 8: Run to verify they pass**

Run: `npm run test:integration -- tests/integration/migrate.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/db/migrate.ts tests/unit/migrate.test.ts tests/integration/migrate.test.ts
git commit -m "feat(db): newest-first revert with a required down-file invariant"
```

---

### Task 3: Baseline stub and record-only mode

**Files:**
- Create: `supabase/migrations/<timestamp>_baseline.sql`
- Modify: `src/db/migrate.ts`
- Modify: `tests/integration/migrate.test.ts`

**Interfaces:**
- Consumes: Task 1's `ensureHistoryTable`, `appliedVersions`, `MigrationFile`.
- Produces:

```ts
export const BASELINE_VERSION: string;   // the stub's version, the single source for it
export async function recordBaseline(client: Queryable, dir: string): Promise<boolean>;
```

`recordBaseline` inserts the baseline's history row **without executing `schema.sql`**, and returns `false` if it was already recorded. This is the operation that must never run the 932-line file against a populated database.

- [ ] **Step 1: Create the baseline stub** `supabase/migrations/<YYYYMMDDHHMMSS>_baseline.sql`

Comment only, no executable SQL. It must state: that `supabase/schema.sql` is the baseline; that it is applied separately (by hand into the SQL Editor, or by the runner on a fresh database); and that a Supabase CLI `db reset` could not rebuild from migrations alone because of this. Set `BASELINE_VERSION` in `src/db/migrate.ts` to this filename's version.

- [ ] **Step 2: Write the failing integration tests**

```ts
test('recordBaseline inserts the baseline version and executes no schema SQL', …)
  // on an empty database: history contains BASELINE_VERSION, and a schema.sql table
  // such as monitors does NOT exist

test('recordBaseline is idempotent and returns false the second time', …)

test('applyPending skips the baseline once it is recorded', …)
  // the stub is never executed as a migration
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:integration -- tests/integration/migrate.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement `recordBaseline` and `BASELINE_VERSION`**

- [ ] **Step 5: Run to verify they pass**

Run: `npm run test:integration -- tests/integration/migrate.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations src/db/migrate.ts tests/integration/migrate.test.ts
git commit -m "feat(db): baseline stub and record-without-executing mode"
```

---

### Task 4: CLI — target selection, destructive guard, PostgREST reload

**Files:**
- Create: `scripts/migrate.ts`
- Modify: `src/db/migrate.ts`
- Modify: `tests/unit/migrate.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces (pure helpers in `src/db/migrate.ts` so they are unit-testable without the CLI):

```ts
export function containsDestructive(sql: string): boolean;
export function isHostedUrl(url: string): boolean;          // a Supabase host
export function confirmValueFor(url: string): string;       // project ref if hosted, else database name
```

`confirmValueFor` must **not** return the database name for a hosted URL: every Supabase session-pooler URI's database is literally `postgres`. Derive the project ref from the pooler username `postgres.<project-ref>`.

CLI contract:

| Invocation | Behaviour |
| --- | --- |
| `npm run migrate` | Target `DATABASE_TEST_URL`. Apply pending. |
| `npm run migrate -- --db-url <url>` | Target that URL. |
| `npm run migrate -- --hosted` | Target `DATABASE_URL`; requires `MIGRATE_CONFIRM=<confirmValueFor(url)>`. |
| `npm run migrate -- --baseline-only` | Record the baseline without executing `schema.sql`, then apply pending. |
| `npm run migrate:down` | Revert the newest applied migration on the selected target. |

No target and no `DATABASE_TEST_URL` is an error, never a fallback. Any statement `containsDestructive` flags requires `MIGRATE_CONFIRM` regardless of target. After a successful run against a hosted target, issue `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 1: Write the failing unit tests**

```ts
test('containsDestructive flags DROP TABLE, DROP COLUMN, TRUNCATE, ALTER .. DROP, unqualified DELETE', …)
test('containsDestructive does not flag a plain CREATE TABLE / ADD COLUMN migration', …)
test('confirmValueFor returns the project ref for a Supabase pooler URL, not "postgres"', …)
  // postgresql://postgres.abcdefgh:pw@aws-0-x.pooler.supabase.com:5432/postgres -> 'abcdefgh'
test('confirmValueFor returns the database name for a local URL', …)
  // postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test -> 'uptimekit_sdd_test'
test('isHostedUrl distinguishes a Supabase host from localhost', …)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the three helpers** in `src/db/migrate.ts`

`containsDestructive` is a regex scan and a deliberate heuristic: it will false-positive on `DROP` inside a string literal or a dollar-quoted body and can be defeated by dynamic SQL in a `DO` block. Mark it with a `ponytail:` comment naming that ceiling, and do not describe it as a guarantee.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/unit/migrate.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `scripts/migrate.ts`** to the contract table above

Follow the existing confirm-guard shape in `scripts/seed-dev.ts:36-42` and `scripts/backfill-daily-rollups.ts:44-52`, but take the expected value from `confirmValueFor`. Create its own `pg.Client` inline as `seed-dev.ts:44` does — do **not** import `src/worker/config/redis.ts`, which throws on a missing `DATABASE_URL` at import time and opens a Redis connection as a side effect (`redis.ts:13,27-32`).

- [ ] **Step 6: Add the npm scripts** to `package.json`

```json
"migrate": "ts-node scripts/migrate.ts",
"migrate:down": "ts-node scripts/migrate.ts --down",
"audit:parity": "ts-node scripts/audit-schema-parity.ts"
```

- [ ] **Step 7: Verify the refusal paths by hand**

Run with `DATABASE_TEST_URL` unset and no flag.
Expected: a non-zero exit and a message naming the missing target. Review Focus item 4 — it must not touch `DATABASE_URL`.

Run `npm run migrate -- --hosted` with `MIGRATE_CONFIRM` unset.
Expected: refusal before any connection is opened.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate.ts src/db/migrate.ts tests/unit/migrate.test.ts package.json
git commit -m "feat(scripts): migrate CLI with target selection and destructive guard"
```

---

### Task 5: Test harness integration and the fence invariant

**Files:**
- Modify: `tests/integration/helpers/db-setup.ts:50-59`
- Modify: `tests/integration/partitioning.test.ts`

**Interfaces:**
- Consumes: Task 1's `applyPending`, `PG_CRON_BLOCK`, `stripPgCronFence`; Task 3's `recordBaseline`.
- Produces: an `applySchema()` whose contract is unchanged for its five existing callers.

Without this, the first migration leaves every database-backed test passing against a schema that lacks it.

- [ ] **Step 1: Write the failing test** in `tests/integration/partitioning.test.ts`

```ts
test('every cron. reference in a migration sits inside the pg_cron fence', …)
  // glob supabase/migrations/**/*.sql; same assertion shape as the existing
  // schema.sql check at partitioning.test.ts:59-70
```

- [ ] **Step 2: Run to verify it fails or passes vacuously**

Run: `npm test -- tests/integration/partitioning.test.ts`
Expected: PASS vacuously (only the comment-only baseline stub exists). Add a temporary fixture file containing an unfenced `cron.schedule(` to confirm it genuinely fails, then delete the fixture.

- [ ] **Step 3: Rewrite `applySchema()`** in `tests/integration/helpers/db-setup.ts`

It keeps applying `schema.sql` with the fence stripped, then calls `recordBaseline` and `applyPending(client, 'supabase/migrations', { stripCron: true })`. Delete the local `PG_CRON_BLOCK` and import it from `src/db/migrate.ts` instead, so one regex governs both paths. Preserve the comment at `:8-12` explaining why there is no `DATABASE_URL` fallback. The destructive guard is **not** consulted here: this path targets a throwaway database and contributors must not need `MIGRATE_CONFIRM` to run `npm test`.

- [ ] **Step 4: Run the whole worker suite**

Run: `npm test`
Expected: PASS, with the same counts as before this task — 61 passed / 35 skipped without `DATABASE_TEST_URL`, 96 passed with it. A changed skip count means `applySchema` broke a caller.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/helpers/db-setup.ts tests/integration/partitioning.test.ts
git commit -m "test: apply migrations in applySchema and extend the pg_cron fence invariant"
```

---

### Task 6: Baseline parity audit

**Files:**
- Create: `scripts/audit-schema-parity.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a standalone read-only report. Nothing imports it.

**This script connects to production. It must be read-only — `SELECT` against system catalogs, no DDL, no DML, no writes of any kind.** It is run once, by the repo owner, with explicit per-run approval. It is not part of `npm run migrate`.

- [ ] **Step 1: Implement `scripts/audit-schema-parity.ts`**

Takes two connection strings and reports differences. Compare, per the spec:

- `information_schema.columns` — table, column, type, nullability, default
- constraints, including the `CHECK` on `monitors.timeout_ms`
- indexes (`pg_indexes`)
- `pg_policies` — policy name, command, expression
- `pg_proc.prosrc` — function bodies, where `CREATE OR REPLACE` drift hides
- triggers
- the partition set on `ping_logs_raw`

Open both connections read-only (`SET default_transaction_read_only = on`) so a coding mistake cannot write. Exit non-zero when differences are found, printing them grouped by category. Reuse the confirm-guard shape from the sibling scripts for the production side.

- [ ] **Step 2: Verify against two local databases**

Create a second throwaway database, apply `schema.sql` to both, confirm the script reports no differences. Then `ALTER TABLE monitors ADD COLUMN probe text` on one and confirm it reports exactly that.

Run: `npm run audit:parity -- --a <url1> --b <url2>`
Expected: clean on the first run; one column difference and a non-zero exit on the second.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-schema-parity.ts
git commit -m "feat(scripts): read-only schema parity audit between two databases"
```

- [ ] **Step 4: Stop. Do not run this against production.**

Running it against the live project needs the owner's explicit go-ahead, separately from approving this plan. Report that the script is ready and wait.

---

### Task 7: Documentation

**Files:**
- Create: `supabase/migrations/README.md`
- Modify: `README.md:112`, `README.md:198`
- Modify: `docs/operations.md`
- Modify: `docs/setup.md`
- Modify: `docs/known-issues.md:50-52`

- [ ] **Step 1: Write `supabase/migrations/README.md`**

Must cover: how to add a migration and its down file; the naming convention; that revert is newest-first only and why that keeps down files tractable; and two honest ceilings — that **reverting a destructive change restores structure, not rows**, and that the six text-asserting test files describe the baseline rather than the current schema, to be converted individually when a migration invalidates one.

- [ ] **Step 2: Update `README.md`**

Step 2 of setup (`:112`) keeps the SQL-Editor paste, then adds the follow-on `npm run migrate -- --baseline-only`. Remove "No migration runner" from the to-do list at `:198`.

- [ ] **Step 3: Update `docs/operations.md`**

"Deploying schema changes" becomes: apply the baseline once, then `npm run migrate`. Keep the apply-schema-before-code rule and its breakage table. State that `NOTIFY pgrst, 'reload schema'` now happens inside the runner, so nobody re-adds it as a manual step.

- [ ] **Step 4: Update `docs/setup.md` and `docs/known-issues.md`**

`docs/setup.md`: add the migration step to the test-database section, and fix the pre-existing gap that it never tells you to apply `tests/integration/helpers/bootstrap-local.sql` first. Note the database-name disagreement (`uptimekit_test` in the docs versus `uptimekit_sdd_test` in `bootstrap-local.sql:7` and `seed-dev.ts:4`) and settle on one. `docs/known-issues.md`: remove the migration-runner to-do item.

- [ ] **Step 5: Verify every changed command actually runs**

Run each command quoted in the docs. A command in a setup guide that was never executed is the defect this project already documented once.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/README.md README.md docs/
git commit -m "docs: migration runner usage, and retire the no-migration-runner to-do"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean from the repo root.
- [ ] `npm test` — same counts as before the branch, plus the new unit and integration tests.
- [ ] `cd src/web && npm test` — 135 tests, untouched by this work.
- [ ] `git diff main --stat` reviewed: no change to `supabase/schema.sql`.
