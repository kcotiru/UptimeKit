# Migration runner: design

**Date:** 2026-10-18
**Branch:** `feat/migration-runner`
**Status:** design, not yet planned or built

---

## Intent

`supabase/schema.sql` is applied by hand: pasted into the Supabase SQL Editor and
run. Nothing anywhere records which changes have been applied to which database.
The last apply went fine, there is no outage driving this, but every future
schema change is another manual paste with no record and no enforced order.

We want schema changes applied by a command, added by dropping in a file, and
revertible after the fact.

### The sharper reason, found during design

`schema.sql` is re-runnable but **not converging**. Any edit made inside a
`CREATE TABLE IF NOT EXISTS` body never reaches a database that already has the
table. The file acknowledges this at line 184, which is why later columns were
bolted on as separate statements instead (`ALTER TABLE … ADD COLUMN IF NOT
EXISTS` at lines 85 and 185–186).

The consequence: a database created fresh from `schema.sql` and a long-lived
production database can **drift apart silently**, and nothing detects it. That is
a stronger argument for this work than "migrations are common practice," and it
is the problem the design should actually solve.

### History worth knowing

This repo had a migration runner until commit `59ef8d2` (2026-08-20):
`src/db/migrations/001-017*.sql` with `down/` counterparts, `migrate.ts` on
node-pg-migrate, and an `npm run migrate` script. That commit's message never
mentions migrations, it is the one that folded in "the pre-existing (previously
uncommitted) Express → Supabase refactor found in the working tree." The runner
went out as collateral damage, not as a decision.

Three days later it *became* a decision.
`docs/superpowers/plans/2026-08-23-closing-concept-gaps.md:15`, as a global
constraint: *"Schema file is the migration. … There is no migrations directory; do
not create one."*

**This design deliberately reverses that rule**, with the owner's approval. The
rule is superseded, not overlooked. `schema.sql` keeps its baseline role, so the
constraint's practical purpose, one file that builds a working database,
survives.

---

## Goals

1. One command applies every pending schema change to a chosen database.
2. Adding a schema change means adding a file. `schema.sql` is never edited again.
3. Every migration has a revert path, rehearsed locally before it touches the
   hosted project.
4. The migration files are the schema's changelog, the documentation of how the
   schema got here.
5. The runner works against a plain local Postgres as well as the hosted Supabase
   project.

## Non-goals

- Running migrations from CI. There is no `.github/` in this repo.
- Multi-environment promotion (staging → production). One developer, one hosted
  project, one local database.
- Declarative schema management or diff generation. Supabase's declarative mode
  runs on a legacy diff engine here, which has an unfixed bug generating
  migrations for partitioned tables (`ping_logs_raw` is partitioned) and misses
  `alter policy` (this schema is largely RLS policies). Wrong tool.
- Adopting the Supabase CLI. Not installed, and not required. The design must
  not *foreclose* adopting it later, which is why the tracking table matches the
  CLI's format, but nothing here depends on the CLI existing.
- Decomposing `schema.sql` into migrations.
- Auto-migrating on worker startup.

## Anti-goals

These make the work a failure even if it runs correctly:

- **Losing ping history.** The owner's hard constraint, stated as "we should not
  lose any valuable data history."
- **Re-running the 932-line baseline against a populated production database.**
- **Tests passing against a stale schema.** A green suite that no longer reflects
  the real schema is worse than a red one.
- **A revert that discards data and reports success.** A down-migration that
  recreates a dropped column recovers the structure, never the rows. The tool
  must say so rather than imply otherwise.

---

## Constraints

From the repo, all verified:

- **No new runtime dependencies.** `pg@^8.12.0` is already a root dependency.
  The repo's own standing rule (`2026-08-23-closing-concept-gaps.md:17`).
- **Node >= 22** (`package.json` engines).
- **`schema.sql` must stay re-runnable.** `tests/integration/tier-columns.test.ts:199-202`
  applies it twice and asserts both succeed.
- **`schema.sql` must not move or be split.** Six test files read it as text and
  assert on its contents: `partitioning.test.ts` (which also asserts the file
  ends with the `-- @local-test:strip-end` sentinel and that no `cron.` reference
  sits outside the fenced region), `monitors.test.ts`, `rollup.test.ts`,
  `tier-query.test.ts`, `rollup-concurrent.test.ts`, `soft-delete-purge.test.ts`.
- **`DATABASE_TEST_URL` must never fall back to `DATABASE_URL`.** Deliberate, with
  the reasoning at `tests/integration/helpers/db-setup.ts:8-13`.
- **The pg_cron region is fenced** by `-- @local-test:strip-start (pg_cron)` and
  `-- @local-test:strip-end` and is stripped for local runs, because local
  Postgres has no pg_cron. Any new code that applies SQL locally must honour
  the same fence.
- **Local Postgres needs `tests/integration/helpers/bootstrap-local.sql` first**
 , it creates the `extensions` schema, pgcrypto, the `anon`/`authenticated`
  roles, and an `auth.users` stub. `schema.sql` does not create these.
- **The hosted project's direct host is IPv6-only.** The session pooler URI is
  required on IPv4 networks.
- **Tests must skip, not fail, without a database.** Standing repo rule.

---

## Decided by the owner

- `schema.sql` **stays the baseline**, frozen as of today. Migrations stack on
  top from today forward.
- Migrations serve double duty as **documentation** of schema history.
- **Rollback is a newest-first unwind, repeatable**: each run reverts the most
  recently applied migration, and running it repeatedly walks back as far as
  needed, so any point in history stays reachable. Reverting one arbitrary older
  migration while later ones remain applied was considered and **rejected**, it
  would force every down file to stay correct even after later migrations altered
  the same objects, which is a contract imposed on whoever writes migrations, not
  just more code in the runner.
- **A one-time parity audit between production and `schema.sql` is in scope**,
  and must run before any baseline row is recorded.
- **No loss of valuable data history.** A hard constraint, not a preference.
- The runner must work against a **local database** as well as the hosted one, so
  a change and its revert can be rehearsed safely first.
- Migration runner is this branch. The landing page is separate work.

The owner was told, and accepted, that reverting a destructive change recovers
structure but not rows, and that running down-migrations in production is less
common than writing them. They want the revert path anyway; the design should
make its limits explicit in the docs rather than pretend otherwise.

---

## Decided by me (the author of this document), not the owner

Flagged so they can be overridden on reading:

- Runner lives at **`scripts/migrate.ts`**, beside the existing `seed-dev.ts` and
  `backfill-daily-rollups.ts`.
- Invoked as **`npm run migrate`** from the repo root.
- **`pg` only.** No new dependency.
- **Never runs automatically on worker boot.** Auto-migrate-on-start is how a
  crash-looping worker half-applies a schema.
- **Destructive statements require explicit opt-in**, reusing the guard pattern
  already in this repo: `seed-dev.ts:36-42` and `backfill-daily-rollups.ts:44-52`
  both require the operator to name the target database in an env var. Same
  mechanism, same muscle memory.
- **Tracking table matches the Supabase CLI's format** so adopting the CLI later
  remains possible.

---

## Mechanics

### Tracking table

Exactly the CLI's shape, so the two stay interchangeable:

```sql
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text NOT NULL PRIMARY KEY
);
ALTER TABLE supabase_migrations.schema_migrations
  ADD COLUMN IF NOT EXISTS statements text[];
ALTER TABLE supabase_migrations.schema_migrations
  ADD COLUMN IF NOT EXISTS name text;
```

The CLI compares **version strings only** and never hashes file contents, so an
edit to an already-applied migration goes undetected. The runner should inherit
that behaviour rather than inventing a stricter one, a hash check would make the
tracking table CLI-incompatible. Worth a comment in the code so the gap is
deliberate rather than an oversight.

### File layout

```
supabase/migrations/<version>_<name>.sql            -- forward
supabase/migrations/down/<version>_<name>.sql       -- revert, same version
```

`<version>` is a 14-digit UTC timestamp, `YYYYMMDDHHMMSS`. The CLI matches
`^([0-9]+)_(.*)\.sql$` and orders by filename, so this naming stays compatible.

### The baseline, the fiddly part

The distinction that matters is **not** fresh-versus-existing, and framing it that
way is a trap, someone following `README.md:112` creates a brand-new hosted
Supabase project and pastes `schema.sql` into the SQL Editor by hand, so a *new*
database can already have the baseline applied.

The only question is: **has `schema.sql` already been applied to this target?**

| Has the baseline been applied? | What must happen |
| --- | --- |
| No (typically a local database) | Apply `bootstrap-local.sql` (local only), then `schema.sql`, then record the baseline version, then apply pending migrations |
| Yes (the hosted project, new or long-lived) | Record the baseline version **without executing `schema.sql`**, then apply pending migrations only |

This is operator intent, not something to auto-detect: the runner must be told
which, and the second case must be the one that requires the explicit flag.
Getting it wrong means re-running 932 lines against a database with real data in
it.

**Open decision for the builder**, with my recommendation. The CLI treats a
version present remotely with no corresponding local file as an error, so the
baseline wants a file. Options:

1. A history row with no file. Simplest; would make a future `supabase db push`
   error.
2. `supabase/migrations/<ts>_baseline.sql` holding a copy of `schema.sql`.
   Duplicates 932 lines, and the six text-asserting tests still point at the
   original, two files to keep in sync, which is exactly the failure mode this
   work exists to remove.
3. **Recommended:** `supabase/migrations/<ts>_baseline.sql` containing only a
   comment that names `supabase/schema.sql` as the baseline and explains that it
   is applied separately. Preserves the CLI's row-to-file invariant; `schema.sql`
   stays the single source.

Option 3's cost: a CLI `db reset` could not rebuild the database from migrations
alone. Acceptable, since adopting the CLI is a non-goal, but it should be stated
in the docs, not discovered later.

### Baseline parity audit, a prerequisite, not an afterthought

Recording the baseline against the hosted project without executing it **asserts
that production already equals `schema.sql`**. Nothing has ever verified that,
and the mechanism this whole design exists to prevent, an edit inside a
`CREATE TABLE IF NOT EXISTS` body never reaching an existing table, is exactly
what would have produced a mismatch. If production has already drifted, the
first history row records something false and every migration after it stacks on
an unverified foundation. The forward drift gets fixed; the backward drift never
does.

So: **before any baseline row is written to the hosted project**, compare it
against a database built fresh from `schema.sql`.

Supabase's declarative/diff engine is a non-goal (see above), so this is
hand-written introspection. Compare, at minimum:

- `information_schema.columns`: name, type, nullability, default, per table
- constraints, including the `CHECK` on `monitors.timeout_ms`
- indexes
- `pg_policies`: RLS policy names, commands, and expressions
- `pg_proc.prosrc`: function bodies, which is where `CREATE OR REPLACE` drift
  would hide
- triggers
- the partition set on `ping_logs_raw`

This is a **read-only** comparison and must stay that way: it connects to
production to `SELECT` from catalogs and writes nothing.

If drift is found, it becomes an explicit first migration that reconciles it,
reviewed by hand before it runs, not something the runner papers over. If no
drift is found, record that fact in the commit or the migrations README, so the
baseline is a verified claim rather than a hopeful one.

The audit is a one-off. It does not become part of the normal `migrate` path.

### Applying a migration

Each migration runs in **its own transaction**, with its history row written
inside the same transaction so the file and its record commit or fail together:

```
BEGIN;
  <file contents>
  INSERT INTO supabase_migrations.schema_migrations(version, name, statements) …
COMMIT;
```

Known exception: `CREATE INDEX CONCURRENTLY`, `REINDEX … CONCURRENTLY`, `VACUUM`,
`ALTER SYSTEM` and `CLUSTER` cannot run inside a transaction block. A migration
containing one of these cannot be atomic. The builder decides whether to detect
and reject them with a clear error or support them as a documented special case;
rejecting is the smaller change and can be revisited.

**Per migration, not per run**, deliberately. `schema.sql:11` advises wrapping a
production apply of *that file* in one explicit `BEGIN`/`COMMIT`, because it drops
and recreates functions hundreds of lines apart and leaves a window where a live
RPC hits a missing function. That reasoning is specific to one monolithic file.
For a sequence of migrations, per-migration transactions are the right unit: a
run that fails halfway leaves a prefix applied and accurately recorded, which is
resumable. One transaction around a whole run would roll back already-correct
migrations and, worse, encourage one enormous migration to get atomicity.

### PostgREST schema reload

`schema.sql:11` instructs `NOTIFY pgrst, 'reload schema';` after a production
apply, and this is load-bearing rather than ceremonial: the web app reaches the
database through PostgREST RPCs, `select_ping_tier`
(`src/web/lib/server/data/monitors.ts:100`), `get_shared_view`
(`saved-views.ts:198`), `describe_invite` (`register-form.tsx:32`). A migration
that redefines any of those leaves PostgREST serving stale OIDs and returning
`PGRST202` until it reloads on its own.

The runner must issue the NOTIFY after a successful run against a hosted target.
This step currently survives only inside the manual paste procedure in
`docs/operations.md` that this work replaces, so without it here it would be
silently dropped.

### Reverting

**Newest-first only.** The runner reverts the most recently applied migration:
read the highest version from the history table, run its down file, and delete
that row in the same transaction. Walking further back is repetition, not a
different feature. The runner takes no "revert version X" target.

A consequence worth stating in the migrations README: a down file only ever has
to be correct against the state its own forward migration created, because
nothing after it can still be applied when it runs. That is what makes down
files tractable to write, and it is the reason out-of-order revert was rejected.

Policy: **a forward migration without a down file is rejected** unless it carries
an explicit marker (e.g. a leading `-- irreversible:` comment with a reason).
This stops "I'll write the down file later" from quietly becoming "there is no
down file," while still allowing genuinely irreversible changes to exist and say
why.

### The destructive guard

Reverts and some forward migrations destroy data. Before executing any statement
that can, the runner requires the operator to name the target in an env var,
matching the existing scripts.

**The guard lives at the command-line entry point, not inside the apply
function.** This matters: `applySchema()` in the test harness also applies
pending migrations (see below), so a guard buried in the shared apply path would
make the first forward migration containing a `DROP COLUMN` fail `beforeAll` in
all five database-backed test files, a hard failure, against the standing rule
that those tests skip rather than fail. The in-process path used by tests builds
a throwaway schema on `DATABASE_TEST_URL` and has no data to protect, so it
bypasses the guard by construction. Contributors must not need to set a confirm
variable to run `npm test`.

**The confirmation value for a hosted target must not be the database name.**
`seed-dev.ts:36` and `backfill-daily-rollups.ts:44` derive it from
`new URL(url).pathname.slice(1)`, which for every Supabase session-pooler URI is
literally `postgres`, generic, guessable, and identical across every Supabase
project. That would make the guard weakest on the one target that must never be
hit by accident, while the local throwaway gets the specific
`uptimekit_sdd_test`. For a hosted target, derive the value from the project ref
instead (the pooler username is `postgres.<project-ref>`). This is a deliberate
deviation from "same mechanism, same muscle memory"; the pattern is reused, the
value is the distinguishing part.

Detection is a **heuristic**: a scan for `DROP TABLE`, `DROP SCHEMA`,
`DROP COLUMN`, `TRUNCATE`, `ALTER … DROP`, `DELETE FROM` without a `WHERE`. It
will produce false positives (a `DROP` inside a string literal or a dollar-quoted
function body) and can be fooled by dynamic SQL in a `DO` block. That ceiling is
acceptable for a guard whose failure mode is "asks for confirmation when it did
not need to," and it should carry a `ponytail:` comment naming the ceiling. It
must not be presented as a safety guarantee.

### Target selection

The runner must never reach production implicitly. `DATABASE_URL` in the root
`.env` points at a real project with real data.

- Default target: `DATABASE_TEST_URL`.
- The hosted project requires an explicit flag *and* the confirm env var.
- No fallback from `DATABASE_TEST_URL` to `DATABASE_URL`, ever, the same rule
  `db-setup.ts:8-13` already enforces for tests.

### The required test-suite change

`tests/integration/helpers/db-setup.ts:54-59` `applySchema()` reads `schema.sql`,
strips the pg_cron fence and executes it. It is called from `beforeAll` in five
test files.

Once migrations exist, those tests run against a schema that is missing every
migration, **passing while testing the wrong thing**, which is an anti-goal
above. `applySchema()` must therefore also apply pending migrations, keeping the
fence-stripping behaviour.

This is the only existing file the design forces us to change **on the day it
ships**. See the next section for the part that goes stale later.

### The text-asserting tests, and their accepted ceiling

Six test files assert on `schema.sql` **as text** rather than against a live
database, e.g. `expect(sql).toContain('PARTITION BY RANGE (timestamp)')`:
`partitioning.test.ts`, `monitors.test.ts`, `rollup.test.ts`,
`tier-query.test.ts`, `rollup-concurrent.test.ts`, `soft-delete-purge.test.ts`.

The first migration that changes anything they assert about leaves them passing
while describing a file that is no longer the schema, the same "passing while
testing the wrong thing" listed as an anti-goal, relocated rather than solved.

**Decision: accept this ceiling for now.** Converting all six to query the
applied database is real work that would delay the runner and arguably deserves
its own branch. Instead:

- State the ceiling plainly in `supabase/migrations/README.md`: these tests
  describe the baseline, not the current schema.
- Convert a test only when a migration actually invalidates it, as part of that
  migration's own work.

This is a deliberate deferral, not an oversight, and should carry a `ponytail:`
comment where the tests read the file so the next person finds the reasoning
instead of the surprise.

---

## Verification

At minimum, one integration test that skips without `DATABASE_TEST_URL` and
proves the loop end to end: apply a migration, assert the schema change and the
history row exist; run its down file, assert both are gone. A second run of the
runner must be a no-op.

Also worth asserting: the runner refuses to apply anything when neither a target
flag nor `DATABASE_TEST_URL` is present, rather than defaulting to something.

**Extend the pg_cron fence invariant to migration files.**
`tests/integration/partitioning.test.ts:59-70` asserts the
`-- @local-test:strip-start (pg_cron)` sentinels bracket every `cron.` reference
in `schema.sql`. Nothing would assert that for a migration, and partition
maintenance, the one thing living inside that fence, is a plausible thing to
change. An unfenced `cron.` reference in a migration breaks every
database-backed test with the confusing "extension not available" error that the
comment at `db-setup.ts:28-50` exists to stop recurring. Extending that test to
glob `supabase/migrations/` is a few lines now versus re-debugging a known
failure later.

## Documentation to update

- `README.md:198`: the "No migration runner" to-do line.
- `docs/known-issues.md:50-52`: same item in the to-do list.
- `docs/operations.md`: "Deploying schema changes" currently says to paste
  `schema.sql`. It becomes: apply the baseline once, then `npm run migrate`.
  The "apply schema before deploying code" rule and its breakage table stand.
  The `NOTIFY pgrst` step moves from prose into the runner; say so, so nobody
  re-adds it as a manual step.
- `README.md:112`: step 2 of setup, which tells a new user to paste
  `schema.sql` into the SQL Editor. That stays correct, but it now needs the
  follow-on step that records the baseline and applies migrations.
- `docs/setup.md`: the test-database section, which must now mention
  `bootstrap-local.sql` (it already omits this, a pre-existing gap) and the
  migration step.
- `supabase/migrations/README.md`: how to add a migration and a down file, and
  the honest statement that reverting a destructive change restores structure,
  not rows.

## Left to the builder

- The exact command surface and flag names.
- Whether the destructive scan runs per statement or per file.
- Statement splitting versus sending each file as one simple-protocol query
  (node-postgres permits the latter, which avoids writing a SQL lexer; the
  `statements text[]` column then needs a sensible value).
- How `applySchema()` shares code with the runner without importing
  `src/worker/config/redis.ts`, which throws on a missing `DATABASE_URL` at
  import time and opens a Redis connection as a side effect (`redis.ts:13,27-32`).
- Whether the baseline stub (option 3) is generated or committed by hand.
