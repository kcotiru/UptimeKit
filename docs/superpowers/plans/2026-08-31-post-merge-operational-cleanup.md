# Post-Merge Operational Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three verified operational gaps left open after the concept-gap branch landed — an unverifiable pg_cron schedule, a timezone-unsafe and unguarded backfill script, and a broken README heading hierarchy.

**Architecture:** Three independent tasks, no shared state. Task 1 moves pg_cron verification from "a text assertion nobody can execute" to "the schema apply itself fails loudly", because pg_cron cannot run on any local harness. Task 2 makes the backfill's day-bucketing connection-independent, adds an explicit-opt-in guard so it cannot be aimed at production by accident, and makes the module importable so the SQL can actually be tested. Task 3 is a pure documentation move.

**Tech Stack:** Postgres 17.7 locally / Postgres 15 (Supabase) in production, Node 22, TypeScript (`module: NodeNext`, CommonJS — no `"type": "module"` in `package.json`), `pg`, Vitest.

**Spec:** No separate spec. This plan implements the three items identified in the post-branch re-audit; the originating design doc is `docs/superpowers/specs/2026-08-23-closing-concept-gaps-design.md` (untracked — `.gitignore` has a bare `specs` entry — but present on disk).

## Global Constraints

- **`DATABASE_URL` in `.env` points at a REAL production Supabase project.** Never run a test, migration, script, or write against it. Any database work uses `DATABASE_TEST_URL` (or an explicitly overridden `DATABASE_URL`) naming the local throwaway database.
- Local test database: `postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test`. Rebuild by creating the database and applying `tests/integration/helpers/bootstrap-local.sql` before `applySchema()`.
- **pg_cron is not available on the local Postgres.** Verified: `SELECT name FROM pg_available_extensions WHERE name='pg_cron'` returns zero rows on the 17.7 Windows instance, and pg_cron does not support Windows at all. No task may add a test that requires pg_cron to execute locally.
- `supabase/schema.sql` is the only migration mechanism, is applied by hand, and **must stay idempotent** — re-running the whole file must succeed.
- The pg_cron block must remain the **last** thing in `supabase/schema.sql`. Every `ENABLE ROW LEVEL SECURITY` and tenant-isolation policy must land before anything that can throw on a project lacking the extension.
- Root and `src/web` are separate npm projects with separate test commands. These tasks touch only the root project.
- Do not merge, push, rebase, or open a pull request. Integration with `main` is handled personally by the user. Commit to the current branch only.
- Ponytail mode is active: shortest diff that actually works, stdlib/native first, no speculative abstraction. Deliberate shortcuts get a `ponytail:` comment naming the ceiling and the upgrade path.

---

### Task 1: Make the pg_cron schedule verify itself at apply time

**Context for the implementer:** `supabase/schema.sql` ends with a `pg_cron` block that schedules daily partition maintenance. If that job is never registered, `ping_logs_raw` runs out of pre-created partitions in about 30 days and **every insert fails silently** — monitoring stops with no visible error. Today the only coverage is `tests/integration/partitioning.test.ts`, which reads `schema.sql` and asserts that `schema.sql` contains certain strings. That guards against someone deleting the block, which is real but weak: it cannot tell you the job actually registered. Since pg_cron cannot execute on any local harness, the verification has to happen at apply time on the real project.

There is a second, structural problem to fix in the same task. `tests/integration/helpers/db-setup.ts` strips the pg_cron block before applying the schema locally, using a regex anchored on the `$job$` dollar-quote delimiter. Its own comment admits this is fragile ("since the file keeps changing"). Adding a verification block *after* `cron.schedule(...)` would fall outside that regex, so the local harness would try to run it, hit a missing `cron` schema, and every DB-backed test would break. Replace the fragile anchor with explicit sentinel comments.

**Files:**
- Modify: `supabase/schema.sql:640-671` (the trailing pg_cron block)
- Modify: `tests/integration/helpers/db-setup.ts:28-47` (the strip regex and its comment)
- Modify: `tests/integration/partitioning.test.ts:19-28`
- Modify: `README.md` (the "Deploying schema changes" section — add the operator verification query)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on. Task 3 also edits `README.md`; do Task 1 first and Task 3 will rebase trivially, or coordinate — the two edit different sections.

- [ ] **Step 1: Read the current pg_cron block and the strip regex**

```bash
sed -n '638,675p' supabase/schema.sql
sed -n '28,49p' tests/integration/helpers/db-setup.ts
```

You must see the block end with a `SELECT cron.schedule(... $job$ ... $job$ );` call, and the regex `/CREATE EXTENSION IF NOT EXISTS pg_cron;[\s\S]*?\$job\$\s*\);\n?/`.

- [ ] **Step 2: Write the failing test**

Add this test to `tests/integration/partitioning.test.ts`, inside the existing `describe` block, after the existing `'schedules recurring partition maintenance...'` test:

```typescript
  it('fails the schema apply when the partition job did not actually register', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

    // pg_cron cannot run on any local harness (no Windows support, and the
    // local Postgres has no pg_cron row in pg_available_extensions), so the
    // only place this can be verified for real is at apply time on Supabase.
    // The schema must therefore assert its own postcondition rather than
    // trusting that cron.schedule() had the intended effect.
    expect(sql).toContain('FROM cron.job');
    expect(sql).toContain("WHERE jobname = 'uptimekit-partitions'");
    expect(sql).toMatch(/RAISE EXCEPTION '[^']*uptimekit-partitions/);
  });

  it('fences the whole pg_cron region with strip sentinels the test harness can find', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

    // db-setup.ts removes this region before applying the schema locally. It
    // used to anchor on the `$job$` dollar-quote, which silently stopped
    // covering anything added after cron.schedule(). Sentinels make the region
    // explicit, so extending it cannot desynchronise the two files.
    expect(sql).toContain('-- @local-test:strip-start (pg_cron)');
    expect(sql).toContain('-- @local-test:strip-end');
    // The sentinels must bracket every cron reference, or the stripped schema
    // still contains a statement that cannot run without the extension.
    const start = sql.indexOf('-- @local-test:strip-start (pg_cron)');
    const end = sql.indexOf('-- @local-test:strip-end');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const outsideSentinels = sql.slice(0, start) + sql.slice(end);
    expect(outsideSentinels).not.toContain('cron.');
    expect(outsideSentinels).not.toContain('pg_cron');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run tests/integration/partitioning.test.ts
```

Expected: the two new tests FAIL. The first on `expect(sql).toContain('FROM cron.job')`, the second on the missing `-- @local-test:strip-start (pg_cron)` sentinel. The three pre-existing tests in the file must still PASS.

- [ ] **Step 4: Add the sentinels and the self-verification block to `supabase/schema.sql`**

Replace the trailing block. The region now opens with a sentinel, and closes with a sentinel after a new `DO` block that asserts the job landed:

```sql
-- ---------------------------------------------------------------------------
-- Partition maintenance schedule (pg_cron)
--
-- Deliberately LAST in this file. This block is the one statement in
-- schema.sql that fails on a project where pg_cron is unavailable, and under
-- `psql -f` without ON_ERROR_STOP, a failing statement does not stop the
-- script — everything after it silently never runs. Every ENABLE ROW LEVEL
-- SECURITY and every tenant-isolation policy above must land before this
-- block has any chance to throw, so an unavailable extension can never leave
-- a table with RLS disabled.
-- Idempotent: create_daily_partition is CREATE TABLE IF NOT EXISTS, and the
-- unschedule/schedule pair means re-running this file does not stack duplicate jobs.
--
-- The sentinel comments below fence the whole region.
-- tests/integration/helpers/db-setup.ts strips everything between them before
-- applying this file to a local Postgres, which has no pg_cron. Keep every
-- `cron.` reference inside the fence.
-- ---------------------------------------------------------------------------

-- @local-test:strip-start (pg_cron)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('uptimekit-partitions');
EXCEPTION WHEN OTHERS THEN
  -- No such job yet on a first run.
  NULL;
END $$;

SELECT cron.schedule(
  'uptimekit-partitions',
  '0 3 * * *',
  $job$
    SELECT create_daily_partition((CURRENT_DATE + i)::date) FROM generate_series(0, 14) i;
    SELECT drop_expired_partitions(7);
  $job$
);

-- Assert the postcondition. Without this, a cron.schedule() that returned but
-- left no row — a pg_cron installed into a database its background worker does
-- not poll, a partially provisioned extension — leaves partition maintenance
-- unscheduled and silent, and ping_logs_raw stops accepting inserts about
-- 30 days later. Failing the schema apply is the loud alternative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'uptimekit-partitions'
  ) THEN
    RAISE EXCEPTION
      'uptimekit-partitions is not registered in cron.job — partition maintenance is NOT scheduled; ping_logs_raw will stop accepting inserts once the pre-created partitions run out';
  END IF;
END $$;
-- @local-test:strip-end
```

- [ ] **Step 5: Point `db-setup.ts` at the sentinels**

In `tests/integration/helpers/db-setup.ts`, replace the `PG_CRON_BLOCK` constant and the comment above it:

```typescript
// schema.sql runs as one multi-statement query here (unlike psql, which keeps
// going statement-by-statement), so a single failing statement aborts every
// statement after it. A local Postgres has no pg_cron extension available
// (pg_available_extensions has no row for it, and pg_cron has no Windows
// support at all), so `CREATE EXTENSION IF NOT EXISTS pg_cron` throws and the
// rest of schema.sql never applies.
//
// Strip the whole fenced region. The fence is explicit sentinel comments
// rather than a match on the block's `$job$` dollar-quote: the old anchor
// stopped at cron.schedule()'s closing paren, so anything appended after it —
// such as the cron.job postcondition assertion — silently escaped the strip
// and broke every DB-backed test. tests/integration/partitioning.test.ts
// asserts that no `cron.` reference survives outside the sentinels.
const PG_CRON_BLOCK =
  /-- @local-test:strip-start \(pg_cron\)[\s\S]*?-- @local-test:strip-end\n?/;
```

Leave `applySchema()` itself unchanged — it already does `.replace(PG_CRON_BLOCK, '')`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run tests/integration/partitioning.test.ts
```

Expected: all five tests PASS.

- [ ] **Step 7: Prove the strip still works against a live database**

This is the step that catches a bad regex. Recreate the local test database from scratch and apply the schema twice through the real helper:

```bash
export PGPASSWORD=postgres
psql -h 127.0.0.1 -U postgres -d postgres -c "DROP DATABASE IF EXISTS uptimekit_sdd_test;"
psql -h 127.0.0.1 -U postgres -d postgres -c "CREATE DATABASE uptimekit_sdd_test;"
psql -h 127.0.0.1 -U postgres -d uptimekit_sdd_test -f tests/integration/helpers/bootstrap-local.sql
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run tests/integration/
```

Expected: the DB-backed integration tests run (not skipped) and PASS. If you see `schema "cron" does not exist` or `extension "pg_cron" is not available`, the sentinel regex is not matching — fix it before continuing.

Then confirm idempotency by running the same `npx vitest run tests/integration/` a second time without recreating the database. Expected: PASS again.

- [ ] **Step 8: Document the operator verification query in `README.md`**

In the `## Deploying schema changes` section, append this at the end of the section (before the next `##` heading — note Task 3 may move this section; that is fine, the content travels with it):

```markdown
### Verifying partition maintenance after applying the schema

`supabase/schema.sql` now raises an exception if the `uptimekit-partitions`
job fails to register, so a successful apply is itself the proof. To confirm
later — or to check that the job is still scheduled and running — run this in
the Supabase SQL Editor:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'uptimekit-partitions';
SELECT status, start_time, return_message
  FROM cron.job_run_details
 WHERE jobname = 'uptimekit-partitions'
 ORDER BY start_time DESC
 LIMIT 5;
```

If the first query returns no rows, partition maintenance is not scheduled:
`ping_logs_raw` will start rejecting every insert once the pre-created
partitions run out, and monitoring stops without a visible error. Re-apply
`supabase/schema.sql`.
```

- [ ] **Step 9: Commit**

```bash
git add supabase/schema.sql tests/integration/helpers/db-setup.ts tests/integration/partitioning.test.ts README.md
git commit -m "fix: make the pg_cron partition job verify its own registration at apply time"
```

---

### Task 2: Make the backfill script timezone-safe, testable, and hard to point at production

**Context for the implementer:** `scripts/backfill-daily-rollups.ts` is a one-shot that recomputes `ping_logs_daily` after the weighted-average fix. It has never been run anywhere. It has three problems.

1. **The UTC pin does not hold.** Line 17 runs `await dbPool.query("SET TIME ZONE 'UTC'")`, which sets the session timezone on **one connection checked out of the pool and immediately returned**. The `date_trunc('day', bucket_start)` query on line 21 may be served by a different connection with a different session timezone, so the day boundaries can be wrong. (`RollupProcessor.processRollup` is already safe — `rollup-processor.ts:61-67` checks out its own client and does `SET LOCAL TIME ZONE 'UTC'` inside its transaction. The bug is confined to this script's own query.)

2. **It is one `npx ts-node` away from rewriting production.** `dbPool` comes from `src/worker/config/redis.ts:25`, which reads `process.env.DATABASE_URL` — which in this repo's `.env` is a **real production Supabase project**. The script `DELETE`s `rollup_logs` markers and recomputes daily rows with no dry-run and no confirmation.

3. **The query cannot be tested.** It is an inline string in a module whose top level both imports `dbPool` (opening an ioredis connection as a side effect) and calls `main()`.

**Files:**
- Modify: `scripts/backfill-daily-rollups.ts`
- Create: `tests/integration/backfill-day-buckets.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `scripts/backfill-daily-rollups.ts` exports `export const DISTINCT_DAYS_SQL: string`. The new test imports it by that exact name.

- [ ] **Step 1: Read the current script and confirm the module system**

```bash
cat scripts/backfill-daily-rollups.ts
grep -n '"type"' package.json
grep -n '"module"' tsconfig.json
```

`package.json` has no `"type"` field and `tsconfig.json` sets `"module": "NodeNext"`, so this compiles to CommonJS and `require.main === module` is the correct entry-point guard. **If either of those has changed, stop and report** — under ESM the guard must become `import.meta.url`-based and the plan needs amending.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/backfill-day-buckets.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';
import { DISTINCT_DAYS_SQL } from '../../scripts/backfill-daily-rollups';

// Same guard shape as tests/integration/shared-view-security.test.ts:5-6 —
// match the existing pattern rather than introducing describe.skipIf.
const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('backfill day bucketing', () => {
  let client: Client;
  let teamId: string;
  let monitorId: string;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);

    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('backfill-tz') RETURNING id`
    );
    teamId = team.rows[0].id;

    const monitor = await client.query<{ id: string }>(
      `INSERT INTO monitors (team_id, name, url) VALUES ($1, 'tz', 'https://example.com') RETURNING id`,
      [teamId]
    );
    monitorId = monitor.rows[0].id;

    // Two hourly buckets that land on the SAME UTC day but on DIFFERENT days
    // in a far-eastern zone: 22:00Z and 23:00Z on 2026-03-10 are both
    // 2026-03-11 in Pacific/Kiritimati (UTC+14).
    for (const ts of ['2026-03-10T22:00:00Z', '2026-03-10T23:00:00Z']) {
      await client.query(
        `INSERT INTO ping_logs_hourly
           (team_id, monitor_id, bucket_start, avg_response_time_ms, total_pings)
         VALUES ($1, $2, $3, 100, 10)`,
        [teamId, monitorId, ts]
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.query('DELETE FROM ping_logs_hourly WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM monitors WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      await client.end();
    }
  });

  it('buckets by UTC day regardless of the session timezone', async () => {
    // The real script runs on a pool, so it cannot rely on any session state.
    // Setting a hostile zone here is what a wrong connection would look like.
    await client.query("SET TIME ZONE 'Pacific/Kiritimati'");

    const { rows } = await client.query<{ bucket: Date }>(DISTINCT_DAYS_SQL);

    const buckets = rows.map((r) => r.bucket.toISOString());
    expect(buckets).toEqual(['2026-03-10T00:00:00.000Z']);
  });

  it('produces the same buckets under UTC', async () => {
    await client.query("SET TIME ZONE 'UTC'");

    const { rows } = await client.query<{ bucket: Date }>(DISTINCT_DAYS_SQL);

    expect(rows.map((r) => r.bucket.toISOString())).toEqual(['2026-03-10T00:00:00.000Z']);
  });
});
```

**Note on the fixture columns:** `ping_logs_hourly` has more `NOT NULL` columns than the four inserted above in some revisions. Before running, check with `\d ping_logs_hourly` (or `sed -n '134,152p' supabase/schema.sql`) and add whatever else is `NOT NULL` without a default. Do not weaken the schema to fit the test.

- [ ] **Step 3: Run the test to verify it fails**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run tests/integration/backfill-day-buckets.test.ts
```

Expected: FAIL at the import — `DISTINCT_DAYS_SQL` is not exported. If instead the run **hangs**, that is the ioredis side effect described above; it confirms the import problem and Step 4 fixes it.

- [ ] **Step 4: Rewrite `scripts/backfill-daily-rollups.ts`**

Replace the whole file:

```typescript
/**
 * One-shot: recompute every ping_logs_daily row still reachable from hourly data.
 * Run once after deploying the weighted-average fix, then delete or ignore.
 *
 *   BACKFILL_CONFIRM=1 npx ts-node scripts/backfill-daily-rollups.ts
 *
 * This deletes rollup_logs markers and rewrites ping_logs_daily. It targets
 * whatever DATABASE_URL points at, which in this repo's .env is production, so
 * it refuses to run without BACKFILL_CONFIRM=1 and prints its target first.
 */

/**
 * Every distinct UTC day that has hourly data.
 *
 * Bucketing is done entirely inside the expression rather than by pinning the
 * session with `SET TIME ZONE 'UTC'`. This runs on a pool: a SET applies to one
 * checked-out connection and the next query can be served by a different one,
 * so a session pin here is not a guarantee, it is a coincidence. `AT TIME ZONE
 * 'UTC'` converts the timestamptz to a UTC wall-clock timestamp, date_trunc
 * finds UTC midnight, and the second `AT TIME ZONE 'UTC'` converts back to
 * timestamptz so node-pg hands back a correct Date.
 */
export const DISTINCT_DAYS_SQL = `
  SELECT DISTINCT
         (date_trunc('day', bucket_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket
    FROM ping_logs_hourly
   ORDER BY bucket ASC
`;

async function main(): Promise<void> {
  if (process.env.BACKFILL_CONFIRM !== '1') {
    console.error(
      '[Backfill] Refusing to run. This DELETEs rollup_logs markers and rewrites\n' +
        '           ping_logs_daily on whatever DATABASE_URL points at.\n' +
        '           Re-run with BACKFILL_CONFIRM=1 once you have checked the target.'
    );
    process.exit(1);
  }

  // Imported lazily: src/worker/config/redis also opens an ioredis connection at
  // module load, which would make this file un-importable from a test.
  const { dbPool } = await import('../src/worker/config/redis');
  const { RollupProcessor } = await import('../src/worker/processors/rollup-processor');

  // Show the target without leaking the password.
  console.log(`[Backfill] target: ${(process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@')}`);

  const processor = new RollupProcessor(dbPool);

  const { rows } = await dbPool.query<{ bucket: Date }>(DISTINCT_DAYS_SQL);

  console.log(`[Backfill] ${rows.length} day(s) to recompute`);

  for (const { bucket } of rows) {
    const timeWindow = bucket.toISOString();

    // The processor short-circuits on a 'completed' rollup_logs row, so clear the
    // marker first or every window returns 'skipped'.
    await dbPool.query(
      `DELETE FROM rollup_logs WHERE rollup_type = 'hourly_to_daily' AND time_window = $1`,
      [timeWindow]
    );

    const result = await processor.processRollup({ rollupType: 'hourly_to_daily', timeWindow });
    console.log(`[Backfill] ${timeWindow} -> ${result.status} (${result.outputCount} rows)`);
  }

  await dbPool.end();
  // Importing dbPool from config/redis also opens an ioredis connection
  // (redisConnection) as a side effect, and nothing here ever closes it.
  // That open socket is an active event-loop handle, so without a hard
  // exit the process hangs forever after printing its last log line.
  process.exit(0);
}

// Guarded so importing this module for its SQL does not run the backfill.
// CommonJS: package.json has no "type" field and tsconfig sets module NodeNext.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('[Backfill] Failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run tests/integration/backfill-day-buckets.test.ts
```

Expected: both tests PASS, and the run **terminates** rather than hanging.

- [ ] **Step 6: Prove the test discriminates**

Temporarily revert `DISTINCT_DAYS_SQL` to the old expression:

```typescript
export const DISTINCT_DAYS_SQL = `
  SELECT DISTINCT date_trunc('day', bucket_start) AS bucket
    FROM ping_logs_hourly
   ORDER BY bucket ASC
`;
```

Re-run the test. Expected: the `regardless of the session timezone` test FAILS (it will report two buckets, or a `2026-03-11` bucket). Then restore the fixed version and confirm PASS again. **If reverting does not turn it red, the test is worthless — say so and fix it rather than keeping it.**

- [ ] **Step 7: Verify the confirmation guard**

```bash
npx ts-node scripts/backfill-daily-rollups.ts
```

Expected: exits non-zero with the "Refusing to run" message, and **never connects to any database**. Confirm no connection was made — the message must appear before any target line.

- [ ] **Step 8: Dry-run the script end to end against the local test database**

Do NOT use the repo `.env` value. Override `DATABASE_URL` for this one invocation only:

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test' \
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}" \
BACKFILL_CONFIRM=1 \
npx ts-node scripts/backfill-daily-rollups.ts
```

Expected: it prints a masked target ending in `/uptimekit_sdd_test`, reports the day count, processes each window, and exits 0. **Read the printed target before letting it proceed — if it does not name `uptimekit_sdd_test`, kill it immediately.**

If it fails because `src/worker/config/redis` requires a reachable Redis and none is running locally, that is an acceptable stopping point: record it in the task report as "guard and SQL verified; full end-to-end dry run blocked on local Redis" rather than working around it by editing the worker config.

- [ ] **Step 9: Run the whole root suite**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run
npx tsc --noEmit
```

Expected: all files pass, no skipped DB tests, `tsc` clean.

- [ ] **Step 10: Commit**

```bash
git add scripts/backfill-daily-rollups.ts tests/integration/backfill-day-buckets.test.ts
git commit -m "fix: bucket backfill days in UTC on the pool, and gate the script behind an explicit confirm"
```

---

### Task 3: Fix the orphaned README setup steps

**Context for the implementer:** `README.md` has `## Setup` containing `### 1. Create the schema`, then a full `## Deploying schema changes` section, and only then `### 2. Configure the web app`, `### 3`, `### 4`. Because `## Deploying schema changes` closes the Setup section, steps 2 through 4 render as subsections of *Deploying schema changes* — a reader following setup is told to configure the web app as part of a deployment-ordering discussion. Move the section so the four numbered steps stay together.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `README.md` as left by Task 1, which appended a `### Verifying partition maintenance after applying the schema` subsection to `## Deploying schema changes`. That subsection moves with its parent.
- Produces: nothing.

- [ ] **Step 1: Read the current structure**

```bash
grep -n '^#\{1,4\} ' README.md
```

Confirm the ordering problem is still present: `## Setup`, `### 1.`, `## Deploying schema changes`, `### 2.`, `### 3.`, `### 4.`, `## Running`.

- [ ] **Step 2: Move the section**

Cut the entire `## Deploying schema changes` block — from its `## Deploying schema changes` heading through the line immediately before `### 2. Configure the web app`, including the `---` separator that precedes the heading — and re-insert it immediately **before** `## Running`, so the order becomes:

```
## Setup
### 1. Create the schema
### 2. Configure the web app
### 3. Configure the worker (optional)
### 4. Install

---

## Deploying schema changes
### Verifying partition maintenance after applying the schema

---

## Running
```

Do not reword any prose. This is a move, not a rewrite. Keep exactly one `---` separator between top-level sections, matching the file's existing convention.

- [ ] **Step 3: Verify the heading hierarchy**

```bash
grep -n '^#\{1,4\} ' README.md
```

Expected: `### 1.` through `### 4.` appear consecutively under `## Setup` with no `##` heading between them, and `## Deploying schema changes` sits between `## Setup` and `## Running`.

- [ ] **Step 4: Verify no links broke**

```bash
grep -n ']( *#' README.md
```

Expected: either no in-page anchor links exist, or every anchor still corresponds to a heading present in the file. If an anchor points at a moved heading, the anchor text is unchanged by a move, so this should be clean — but check rather than assume.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: keep the numbered setup steps together under Setup"
```

---

## Out of scope

Recorded so no implementer picks them up:

- **Merging, pushing, rebasing, or opening a PR.** The user handles integration with `main` personally. The branch currently has 22 unpushed commits and is 5 commits behind `origin/main` (only `README.md` differs — note Tasks 1 and 3 both touch it, so expect a one-line conflict there when the user integrates).
- **Deciding the fate of `.claude/context/` (untracked) and `.superpowers/sdd/2026-08-23-closing-concept-gaps/` (git-ignored).** The user has not ruled.
- **Narrowing the bare `specs` entry in `.gitignore:148`** so `docs/superpowers/specs/*` becomes trackable.
- **Exact daily percentiles.** Still the documented approximation with a `ponytail:` comment naming t-digest.
