# Closing the Concept Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship public shareable saved graph views, and fix the five correctness/operations defects that undermine the data those views display.

**Architecture:** The three-tier metric query body is lifted into `select_ping_tier_for_team(team_id, ...)` so two callers share it: the existing RLS-scoped `select_ping_tier()` for logged-in users, and a new `SECURITY DEFINER` `get_shared_view(token)` that serves anonymous visitors by treating the share token as the authorization. Everything else is localised fixes to the rollup SQL, the partition maintenance story, and the monitor timeout plumbing.

**Tech Stack:** PostgreSQL 15 (Supabase) with pg_cron, Node 22, TypeScript, BullMQ + ioredis, `pg`, Next.js 14 App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-closing-concept-gaps-design.md`

## Global Constraints

- **Schema file is the migration.** `supabase/schema.sql` must stay idempotent and re-runnable top to bottom. Every statement is `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, or a `DROP ... IF EXISTS` immediately followed by a create. There is no migrations directory; do not create one.
- **Node >= 22** (`package.json` engines). Root project and `src/web` are separate npm projects with separate `package_lock.json` files.
- **No new runtime dependencies.** Everything needed is already installed in both projects.
- **Two test commands.** Worker/schema: `npm test` from the repo root. Web: `npm test` from `src/web`. Never run one expecting the other's tests.
- **Database-backed tests skip, never fail.** Any test needing Postgres reads `process.env.DATABASE_TEST_URL` and calls `describe.skip` when it is absent. Contributors without a database must still get a green suite.
- **Anonymous exposure rule.** `get_shared_view` must never return `monitors.url`. This is enforced in the SQL function's `RETURNS TABLE` shape, not in React.
- **Timeout bounds are 1000-30000 ms** everywhere they appear: the `CHECK` constraint, `createMonitorSchema`, and any UI input `min`/`max`.
- **Token format:** 43 characters, alphabet `[A-Za-z0-9_-]` (base64url of 32 random bytes, padding stripped).

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/web/lib/shared/validations/saved-view.ts` | Zod schema for creating a saved view |
| `src/web/lib/server/data/saved-views.ts` | Pure data functions over a `SupabaseClient` — list, create, revoke, delete, and the anonymous `getSharedView` |
| `src/web/lib/server/actions/saved-views.ts` | `'use server'` wrappers resolving the session and calling the data layer |
| `src/web/components/monitors/save-view-button.tsx` | Save-and-copy-link control on the monitor detail view |
| `src/web/components/settings/saved-view-list.tsx` | Manage list under `/dashboard/settings` |
| `src/web/app/share/[token]/page.tsx` | Public, session-free Server Component |
| `src/web/tests/saved-views.test.ts` | Validation and row-mapping tests for the above |
| `tests/integration/shared-view-security.test.ts` | The four-case `get_shared_view` security test, plus redaction and snapping |
| `tests/unit/weighted-average.test.ts` | Arithmetic proof of the weighted daily average |

**Modified:**

| File | Change |
| --- | --- |
| `supabase/schema.sql` | pg_cron job, `monitors.timeout_ms`, `gen_share_token()`, `saved_views` columns, function split, `get_shared_view` |
| `src/worker/processors/rollup-processor.ts:132` | Weighted average |
| `src/worker/processors/purge-processor.ts` | Revoke saved views inside the purge transaction |
| `src/worker/queues/types.ts` | `PingJobPayload.timeoutMs` |
| `src/worker/schedulers/monitor-scheduler.ts` | Select and forward `timeout_ms` |
| `src/worker/processors/ping-processor.ts:47` | Use the per-job timeout |
| `src/web/lib/shared/types.ts` | `SavedView`, `SharedView`, `SharedViewPoint` |
| `src/web/lib/server/data/monitors.ts` | Read the real `timeout_ms` column |
| `src/web/lib/shared/validations/monitor.ts` | Comment tying bounds to the new CHECK |
| `src/web/components/monitors/monitor-detail-view.tsx` | Mount the save button; label the source tier |
| `src/web/app/dashboard/settings/page.tsx` | Render the saved-view list |
| `src/web/middleware.ts` | Comment recording that `/share` is deliberately unmatched |

**Deleted:**

- `tests/integration/quota-enforcement.test.ts` — asserts `schema.sql` contains a string read from `schema.sql`.

---

# Phase 1 — Stop the bleeding

### Task 1: Partition maintenance job

Without this, `INSERT INTO ping_logs_raw` starts failing roughly 30 days after the schema was last applied, and monitoring stops with no alert. `drop_expired_partitions()` also gets its first ever caller.

**Files:**
- Modify: `supabase/schema.sql:292-300` (replace the `DO` block's trailing comment and add the cron schedule after it)
- Test: `tests/integration/partitioning.test.ts`

**Interfaces:**
- Consumes: `create_daily_partition(DATE)` and `drop_expired_partitions(INTEGER)`, both already defined at `schema.sql:217` and `schema.sql:235`.
- Produces: a pg_cron job named `uptimekit-partitions`. No TypeScript surface.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/partitioning.test.ts`:

```typescript
it('schedules recurring partition maintenance instead of relying on a one-off DO block', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

  expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pg_cron");
  expect(sql).toContain("uptimekit-partitions");
  // The job must both create ahead and drop behind — creating alone leaks disk.
  expect(sql).toContain('drop_expired_partitions(7)');
  // Unscheduling first is what makes re-running schema.sql idempotent.
  expect(sql).toContain("cron.unschedule('uptimekit-partitions')");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/partitioning.test.ts`
Expected: FAIL — `expected '...' to contain "CREATE EXTENSION IF NOT EXISTS pg_cron"`

- [ ] **Step 3: Write the schema change**

In `supabase/schema.sql`, replace the two-line `ponytail:` comment above the pre-create `DO` block (lines 293-294) with a plain description, then add this immediately after that `DO` block closes:

```sql
-- Keep a rolling 14-day runway of partitions and drop what retention has passed.
-- Idempotent: create_daily_partition is CREATE TABLE IF NOT EXISTS, and the
-- unschedule/schedule pair means re-running this file does not stack duplicate jobs.
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
```

Note the `$job$` dollar-quote tag: the body cannot use bare `$$` because it is nested inside a file that already uses `$$` for function bodies.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/partitioning.test.ts`
Expected: PASS

- [ ] **Step 5: Apply to a real database and confirm the job exists**

Paste the whole of `supabase/schema.sql` into the Supabase SQL editor and run it, then run:

```sql
SELECT jobname, schedule FROM cron.job WHERE jobname = 'uptimekit-partitions';
```

Expected: exactly one row, `0 3 * * *`. Run the schema file a second time and re-query — still exactly one row. If `CREATE EXTENSION pg_cron` errors, stop and report it; the fallback is discussed in the spec's Risks section and needs a decision, not a workaround.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql tests/integration/partitioning.test.ts
git commit -m "fix: schedule recurring partition maintenance via pg_cron"
```

---

### Task 2: Weighted daily average

`AVG(avg_response_time_ms)` over 24 hourly rows gives a 2-ping hour the same weight as a 120-ping hour, so a quiet hour with one slow request drags the whole day.

**Files:**
- Modify: `src/worker/processors/rollup-processor.ts:132`
- Create: `tests/unit/weighted-average.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `weightedAverage(rows: Array<{ avg: number; count: number }>): number` exported from `src/worker/processors/rollup-processor.ts`, used only by the test as an executable statement of the SQL's intent.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/weighted-average.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { weightedAverage } from '../../src/worker/processors/rollup-processor';

describe('weightedAverage', () => {
  it('weights each hour by its ping count, not equally', () => {
    // A quiet hour of 2 slow pings and a busy hour of 100 fast ones.
    // Unweighted AVG gives 550ms and libels the service; weighted gives ~118ms.
    const rows = [
      { avg: 1000, count: 2 },
      { avg: 100, count: 100 },
    ];
    expect(weightedAverage(rows)).toBe(118);
  });

  it('returns 0 rather than dividing by zero when every hour is empty', () => {
    expect(weightedAverage([{ avg: 0, count: 0 }])).toBe(0);
  });

  it('matches the plain average when every hour has the same count', () => {
    const rows = [
      { avg: 100, count: 10 },
      { avg: 200, count: 10 },
    ];
    expect(weightedAverage(rows)).toBe(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/weighted-average.test.ts`
Expected: FAIL — `No "weightedAverage" export is defined`

- [ ] **Step 3: Add the helper and fix the SQL**

Add to `src/worker/processors/rollup-processor.ts`, next to `closedBucket`:

```typescript
/**
 * The daily average the hourly_to_daily SQL computes, expressed in TypeScript so
 * the weighting is testable without a database. Keep the two in step: an hour is
 * weighted by its ping count, because a quiet hour is not worth a busy one.
 */
export function weightedAverage(rows: Array<{ avg: number; count: number }>): number {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return 0;
  return Math.round(rows.reduce((sum, r) => sum + r.avg * r.count, 0) / total);
}
```

Then in the `hourly_to_daily` aggregate query, replace line 132:

```sql
            ROUND(AVG(avg_response_time_ms))::int AS avg_response_time_ms,
```

with:

```sql
            -- Weighted by ping count: see weightedAverage() in this file.
            -- NULLIF guards a day whose hourly rows are all empty, which would
            -- otherwise divide by zero and abort the rollup transaction.
            ROUND(SUM(avg_response_time_ms::numeric * total_pings)
                  / NULLIF(SUM(total_pings), 0))::int AS avg_response_time_ms,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/weighted-average.test.ts tests/worker/rollup-processor.test.ts`
Expected: PASS, both files. The existing rollup test asserts query structure; if it asserts the literal old `AVG(avg_response_time_ms)` string, update that assertion to the new expression rather than reverting the fix.

- [ ] **Step 5: Document the percentile approximation in the same pass**

Directly above the three `PERCENTILE_CONT` lines in the `hourly_to_daily` query (`rollup-processor.ts:135-137`), add:

```sql
            -- ponytail: these are percentiles OF hourly percentiles, not true daily
            -- percentiles — the raw rows are gone by day 7. Error is unbounded but
            -- bounded in practice by how uniform the hours are. Upgrade path is a
            -- mergeable sketch (t-digest); the UI labels daily points as approximate.
```

- [ ] **Step 6: Commit**

```bash
git add src/worker/processors/rollup-processor.ts tests/unit/weighted-average.test.ts
git commit -m "fix: weight daily average by ping count; document percentile approximation"
```

---

### Task 3: Backfill the already-wrong daily rows

Task 2 fixes new rollups only. Existing `ping_logs_daily` rows keep their unweighted averages until recomputed. Hourly data survives 90 days, so the backfill window is bounded.

**Files:**
- Create: `scripts/backfill-daily-rollups.ts`

**Interfaces:**
- Consumes: `RollupProcessor` from `src/worker/processors/rollup-processor`, `dbPool` from `src/worker/config/redis`.
- Produces: a one-shot script. Nothing imports it.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-daily-rollups.ts`:

```typescript
/**
 * One-shot: recompute every ping_logs_daily row still reachable from hourly data.
 * Run once after deploying the weighted-average fix, then delete or ignore.
 *
 *   npx ts-node scripts/backfill-daily-rollups.ts
 */
import { dbPool } from '../src/worker/config/redis';
import { RollupProcessor } from '../src/worker/processors/rollup-processor';

async function main(): Promise<void> {
  const processor = new RollupProcessor(dbPool);

  const { rows } = await dbPool.query<{ bucket: string }>(
    `SELECT DISTINCT date_trunc('day', bucket_start) AS bucket
       FROM ping_logs_hourly
      ORDER BY bucket ASC`
  );

  console.log(`[Backfill] ${rows.length} day(s) to recompute`);

  for (const { bucket } of rows) {
    const timeWindow = new Date(bucket).toISOString();

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
}

main().catch((err: unknown) => {
  console.error('[Backfill] Failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. `scripts/` is inside the root `tsconfig.json` `include` glob only if `src/**/*` matches it — it does not, so add `"scripts/**/*"` to the `include` array in `tsconfig.json` and re-run.

- [ ] **Step 3: Dry-run against the test database**

Run: `DATABASE_URL="$DATABASE_TEST_URL" npx ts-node scripts/backfill-daily-rollups.ts`
Expected: one `-> completed` line per distinct day present in `ping_logs_hourly`, then a clean exit. If `ping_logs_hourly` is empty the script prints `0 day(s)` and exits — that is a pass, not a failure.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-daily-rollups.ts tsconfig.json
git commit -m "chore: add one-shot backfill for weighted daily rollups"
```

---

# Phase 2 — Schema and plumbing

### Task 4: Per-monitor timeout column

The UI collects a timeout, the validator bounds it, the detail page displays a hardcoded constant, and the worker ignores all three.

**Files:**
- Modify: `supabase/schema.sql` (after the `monitors` table definition, before `idx_monitor_team_active`)
- Modify: `src/worker/queues/types.ts:5-11`
- Modify: `src/worker/schedulers/monitor-scheduler.ts:26-52` and `:66-90`
- Modify: `src/worker/processors/ping-processor.ts:45-50`
- Modify: `src/web/lib/server/data/monitors.ts:6-11, 17-35, 71-84`
- Test: `tests/worker/scheduler.test.ts`, `src/web/tests/server-data.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PingJobPayload` gains `timeoutMs?: number`. `MonitorScheduler.scheduleMonitor` accepts `{ id, teamId, url, expectedStatus, checkInterval, timeoutMs }`. `MonitorRow` in `data/monitors.ts` gains `timeout_ms: number`. Optional on the payload so a job enqueued before this deploy still processes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worker/scheduler.test.ts`:

```typescript
it('forwards each monitor timeout into the ping job payload', async () => {
  const dbPool: any = {
    query: vi.fn().mockResolvedValue({
      rows: [{ id: 'm1', team_id: 't1', url: 'https://a.test', expected_status: 200, check_interval: 60, timeout_ms: 1500 }],
    }),
  };
  const queue: any = {
    upsertJobScheduler: vi.fn().mockResolvedValue({}),
    getJobSchedulers: vi.fn().mockResolvedValue([]),
  };

  await new MonitorScheduler(dbPool, queue).syncMonitors();

  expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
    'monitor:m1',
    { every: 60000 },
    expect.objectContaining({ data: expect.objectContaining({ timeoutMs: 1500 }) })
  );
});
```

Append to `src/web/tests/server-data.test.ts`, inside the existing `describe('listMonitors')`:

```typescript
it('reads the real timeout column rather than a hardcoded constant', async () => {
  const { db } = stubDb({ data: [{ ...monitorRow, timeout_ms: 12000 }], error: null });
  const [monitor] = await listMonitors(db);
  expect(monitor.timeoutMs).toBe(12000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/worker/scheduler.test.ts` then `cd src/web && npm test -- tests/server-data.test.ts`
Expected: FAIL — the scheduler payload has no `timeoutMs`; `monitor.timeoutMs` is `5000`, not `12000`.

- [ ] **Step 3: Add the column**

In `supabase/schema.sql`, immediately after the `CREATE TABLE IF NOT EXISTS monitors (...)` statement and before `CREATE INDEX ... idx_monitor_team_active`:

```sql
-- Added after the initial release, so ADD COLUMN rather than a table field.
-- Bounds mirror createMonitorSchema in src/web/lib/shared/validations/monitor.ts.
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 5000;

DO $$
BEGIN
  ALTER TABLE monitors ADD CONSTRAINT monitors_timeout_ms_range
    CHECK (timeout_ms BETWEEN 1000 AND 30000);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
```

- [ ] **Step 4: Thread it through the worker**

`src/worker/queues/types.ts` — add to `PingJobPayload`:

```typescript
  /** Per-monitor HTTP timeout. Optional: a job enqueued before this field
   *  existed still processes, falling back to workerConfig.defaultHttpTimeoutMs. */
  timeoutMs?: number;
```

`src/worker/schedulers/monitor-scheduler.ts` — add `timeoutMs: number` to the `scheduleMonitor` parameter type and to `IMonitorScheduler`, include it in the `payload` object, add `timeout_ms` to the `SELECT` list in `syncMonitors`, and map it:

```typescript
        timeoutMs: row.timeout_ms || 5000,
```

`src/worker/processors/ping-processor.ts` — replace the third argument at line 49:

```typescript
      const response = await this.pingClient.executePing(
        url,
        ssrfResult.resolvedIp,
        jobData.timeoutMs ?? workerConfig.defaultHttpTimeoutMs
      );
```

- [ ] **Step 5: Thread it through the web app**

`src/web/lib/server/data/monitors.ts` — delete the `DEFAULT_TIMEOUT_MS` constant and its `ponytail:` comment (lines 6-11), add `timeout_ms` to `MONITOR_COLUMNS` and to the `MonitorRow` interface, then in `toMonitor`:

```typescript
    timeoutMs: row.timeout_ms,
```

and in `createMonitor`'s insert object:

```typescript
      timeout_ms: parsed.data.timeoutMs,
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npm test` from the root, then `npm test` from `src/web`
Expected: PASS in both.

- [ ] **Step 7: Commit**

```bash
git add supabase/schema.sql src/worker src/web/lib/server/data/monitors.ts tests src/web/tests
git commit -m "feat: honour a per-monitor timeout instead of a global constant"
```

---

### Task 5: Split the tier query so a team can be passed in

Pure refactor. No behaviour changes for any current caller — but Task 7 cannot be written until this exists.

**Files:**
- Modify: `supabase/schema.sql:305-380` (the `select_ping_tier` definition)
- Test: `tests/integration/tier-query.test.ts`

**Interfaces:**
- Produces: `select_ping_tier_for_team(target_team_id UUID, target_monitor_id UUID, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ)` returning the same eight columns as `select_ping_tier` (`ts`, `response_time_ms`, `min_time_ms`, `max_time_ms`, `p95_time_ms`, `sample_count`, `status_code`, `source_tier`). `SECURITY INVOKER`, `STABLE`, `SET search_path = public`.
- `select_ping_tier(target_monitor_id, start_time, end_time)` keeps its exact signature and return shape. `src/web/lib/server/data/monitors.ts:getMetrics` is untouched.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/tier-query.test.ts`:

```typescript
it('exposes a team-parameterised tier query that select_ping_tier delegates to', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

  expect(sql).toContain('FUNCTION select_ping_tier_for_team(');
  // The wrapper must delegate, not carry a second copy of the UNION.
  const wrapper = sql.slice(sql.indexOf('FUNCTION select_ping_tier(target_monitor_id'));
  const wrapperBody = wrapper.slice(0, wrapper.indexOf('$$ LANGUAGE'));
  expect(wrapperBody).toContain('select_ping_tier_for_team(current_team_id()');
  expect(wrapperBody).not.toContain('UNION ALL');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/tier-query.test.ts`
Expected: FAIL — `expected '...' to contain "FUNCTION select_ping_tier_for_team("`

- [ ] **Step 3: Rewrite the two functions**

Replace the entire `CREATE OR REPLACE FUNCTION select_ping_tier(...)` block in `supabase/schema.sql` with the following. The UNION body is the existing one verbatim, with `target_team_id` becoming a parameter instead of a local `DECLARE`:

```sql
-- The three-tier read, with the tenant as a parameter. SECURITY INVOKER, so an
-- authenticated caller passing another team's UUID still hits RLS on the
-- ping_logs_* tables and gets nothing. Called from get_shared_view (which is
-- SECURITY DEFINER), the invoker is the definer's role and RLS is bypassed —
-- that is the whole point of the split.
CREATE OR REPLACE FUNCTION select_ping_tier_for_team(
  target_team_id UUID,
  target_monitor_id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
RETURNS TABLE (
  -- Named `ts`, not `timestamp`: an output column named `timestamp` is parsed
  -- as a type name and fails, even though the base tables may use that name.
  ts TIMESTAMPTZ,
  response_time_ms NUMERIC,
  min_time_ms INTEGER,
  max_time_ms INTEGER,
  p95_time_ms INTEGER,
  sample_count INTEGER,
  status_code INTEGER,
  source_tier TEXT
) AS $$
DECLARE
  now_ts TIMESTAMPTZ := NOW();
  raw_cutoff TIMESTAMPTZ := now_ts - INTERVAL '7 days';
  hourly_cutoff TIMESTAMPTZ := now_ts - INTERVAL '90 days';
BEGIN
  RETURN QUERY
  SELECT
    r.timestamp,
    r.response_time_ms::NUMERIC,
    r.response_time_ms,
    r.response_time_ms,
    r.response_time_ms,
    1,
    r.status_code,
    'raw'::TEXT
  FROM ping_logs_raw r
  WHERE r.monitor_id = target_monitor_id
    AND r.team_id = target_team_id
    AND r.timestamp BETWEEN start_time AND end_time
    AND r.timestamp >= raw_cutoff

  UNION ALL

  SELECT
    h.bucket_start,
    h.avg_response_time_ms::NUMERIC,
    h.min_response_time_ms,
    h.max_response_time_ms,
    h.p95_response_time_ms,
    h.total_pings,
    NULL::INTEGER,
    'hourly'::TEXT
  FROM ping_logs_hourly h
  WHERE h.monitor_id = target_monitor_id
    AND h.team_id = target_team_id
    AND h.bucket_start BETWEEN start_time AND end_time
    AND h.bucket_start < raw_cutoff
    AND h.bucket_start >= hourly_cutoff

  UNION ALL

  SELECT
    d.bucket_start,
    d.avg_response_time_ms::NUMERIC,
    d.min_response_time_ms,
    d.max_response_time_ms,
    d.p95_response_time_ms,
    d.total_pings,
    NULL::INTEGER,
    'daily'::TEXT
  FROM ping_logs_daily d
  WHERE d.monitor_id = target_monitor_id
    AND d.team_id = target_team_id
    AND d.bucket_start BETWEEN start_time AND end_time
    AND d.bucket_start < hourly_cutoff

  ORDER BY 1 ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- Unchanged signature — src/web/lib/server/data/monitors.ts calls this via RPC.
CREATE OR REPLACE FUNCTION select_ping_tier(
  target_monitor_id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
RETURNS TABLE (
  ts TIMESTAMPTZ,
  response_time_ms NUMERIC,
  min_time_ms INTEGER,
  max_time_ms INTEGER,
  p95_time_ms INTEGER,
  sample_count INTEGER,
  status_code INTEGER,
  source_tier TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM select_ping_tier_for_team(
    current_team_id(), target_monitor_id, start_time, end_time
  );
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/tier-query.test.ts`
Expected: PASS

- [ ] **Step 5: Confirm the existing chart still works**

Apply `supabase/schema.sql` to your Supabase project, then open a monitor detail page in the running dashboard and switch between the 1h / 24h / 7d presets. Expected: the chart renders as before. This is a refactor — any visible change is a regression, not an improvement.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql tests/integration/tier-query.test.ts
git commit -m "refactor: parameterise the tier query by team so non-session callers can use it"
```

---

### Task 6: saved_views columns and token generation

**Files:**
- Modify: `supabase/schema.sql:199-211` (after the `saved_views` table, before its indexes)
- Test: `tests/integration/shared-view-security.test.ts` (new file, first tests)

**Interfaces:**
- Produces: `gen_share_token() RETURNS TEXT` — 43-char base64url. `saved_views` gains `monitor_id UUID REFERENCES monitors(id)` and `revoked_at TIMESTAMPTZ`; `share_token` defaults to `gen_share_token()`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/shared-view-security.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';

const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('Shared view security', () => {
  let client: Client;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);
  }, 60_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  it('generates 43-char URL-safe tokens that do not collide', async () => {
    const { rows } = await client.query<{ token: string }>(
      'SELECT gen_share_token() AS token FROM generate_series(1, 1000)'
    );

    expect(rows).toHaveLength(1000);
    for (const { token } of rows) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(new Set(rows.map((r) => r.token)).size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/shared-view-security.test.ts`
Expected: with `DATABASE_TEST_URL` set, FAIL with `function gen_share_token() does not exist`. Without it, the suite reports as skipped — set the variable before continuing, or this task cannot be verified.

- [ ] **Step 3: Add the function and columns**

In `supabase/schema.sql`, immediately after the `CREATE TABLE IF NOT EXISTS saved_views (...)` statement:

```sql
-- base64url: Postgres has no built-in encoder for it, so translate the two
-- URL-unsafe characters out of standard base64 and strip the padding.
-- 32 random bytes -> 43 characters, 256 bits of entropy.
CREATE OR REPLACE FUNCTION gen_share_token()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

-- Added after the table shipped, so ALTER rather than table fields.
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS monitor_id UUID REFERENCES monitors(id);
-- Revoke kills a leaked link without destroying the saved window.
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE saved_views ALTER COLUMN share_token SET DEFAULT gen_share_token();

CREATE INDEX IF NOT EXISTS idx_saved_views_monitor_id ON saved_views(monitor_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/shared-view-security.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql tests/integration/shared-view-security.test.ts
git commit -m "feat: add share token generation and revocation columns to saved_views"
```

---

# Phase 3 — The feature

### Task 7: `get_shared_view` — the security boundary

This is the first `SECURITY DEFINER` function in the codebase that accepts attacker-controlled input. Its tests are not optional.

**Files:**
- Modify: `supabase/schema.sql` (after the `select_ping_tier` block from Task 5)
- Test: `tests/integration/shared-view-security.test.ts`

**Interfaces:**
- Consumes: `select_ping_tier_for_team` (Task 5), `saved_views.revoked_at` and `.monitor_id` (Task 6).
- Produces: `get_shared_view(token TEXT)` returning `view_name TEXT, monitor_name TEXT, monitor_status TEXT, window_from TIMESTAMPTZ, window_to TIMESTAMPTZ, ts TIMESTAMPTZ, response_time_ms NUMERIC, min_time_ms INTEGER, max_time_ms INTEGER, p95_time_ms INTEGER, sample_count INTEGER, source_tier TEXT`. Consumed by Task 8's data layer.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/shared-view-security.test.ts`, inside the `suite` block:

```typescript
  /** Builds a team, monitor, one raw ping, and a saved view over it. */
  async function seedView(overrides: { revoked?: boolean; deletedMonitor?: boolean } = {}) {
    const { rows: [team] } = await client.query(
      `INSERT INTO teams (name) VALUES ('t') RETURNING id`
    );
    const { rows: [monitor] } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Checkout API', 'https://internal.example.test/health', 60) RETURNING id`,
      [team.id]
    );
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date();
    await client.query(
      `INSERT INTO ping_logs_raw (monitor_id, team_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3, 412, 200)`,
      [monitor.id, team.id, new Date(Date.now() - 30 * 60 * 1000)]
    );
    const { rows: [view] } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration, revoked_at)
       VALUES ($1, NULL, $2, 'Outage window', $3::jsonb, $4)
       RETURNING share_token`,
      [
        team.id,
        monitor.id,
        JSON.stringify({ from: from.toISOString(), to: to.toISOString() }),
        overrides.revoked ? new Date() : null,
      ]
    );
    if (overrides.deletedMonitor) {
      await client.query(`UPDATE monitors SET is_deleted = true WHERE id = $1`, [monitor.id]);
    }
    return { token: view.share_token as string, monitorId: monitor.id as string };
  }

  it('returns the series for a valid token', async () => {
    const { token } = await seedView();
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].monitor_name).toBe('Checkout API');
    expect(rows[0].view_name).toBe('Outage window');
  });

  it('never exposes the monitor URL', async () => {
    const { token } = await seedView();
    const { rows, fields } = await client.query('SELECT * FROM get_shared_view($1)', [token]);

    expect(fields.map((f) => f.name)).not.toContain('url');
    expect(JSON.stringify(rows)).not.toContain('internal.example.test');
  });

  it('returns nothing for a revoked token', async () => {
    const { token } = await seedView({ revoked: true });
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);
    expect(rows).toHaveLength(0);
  });

  it('returns nothing for an unknown token', async () => {
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', ['x'.repeat(43)]);
    expect(rows).toHaveLength(0);
  });

  it('returns nothing once the monitor is soft-deleted', async () => {
    const { token } = await seedView({ deletedMonitor: true });
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);
    expect(rows).toHaveLength(0);
  });

  it('snaps an old window out to day boundaries so it is not silently empty', async () => {
    const { rows: [team] } = await client.query(`INSERT INTO teams (name) VALUES ('t2') RETURNING id`);
    const { rows: [monitor] } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Old', 'https://old.test', 60) RETURNING id`,
      [team.id]
    );
    // A daily bucket 200 days back, stamped midnight.
    const day = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    day.setUTCHours(0, 0, 0, 0);
    await client.query(
      `INSERT INTO ping_logs_daily (team_id, monitor_id, bucket_start, total_pings, successful_pings,
         avg_response_time_ms, min_response_time_ms, max_response_time_ms,
         p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3, 100, 99, 120, 40, 900, 110, 300, 800)`,
      [team.id, monitor.id, day]
    );
    // A 02:00-06:00 window inside that day matches no midnight-stamped bucket
    // unless the function widens it.
    const from = new Date(day); from.setUTCHours(2);
    const to = new Date(day); to.setUTCHours(6);
    const { rows: [view] } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, NULL, $2, 'Ancient', $3::jsonb) RETURNING share_token`,
      [team.id, monitor.id, JSON.stringify({ from: from.toISOString(), to: to.toISOString() })]
    );

    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [view.share_token]);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_tier).toBe('daily');
  });
```

`saved_views.creator_id` is `NOT NULL REFERENCES users(id)` in the current schema, and these tests have no `auth.users` row to point at. Before running them, relax it in `supabase/schema.sql` — a view outliving the person who made it is correct behaviour, not a test concession:

```sql
ALTER TABLE saved_views ALTER COLUMN creator_id DROP NOT NULL;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/integration/shared-view-security.test.ts`
Expected: FAIL with `function get_shared_view(unknown) does not exist`

- [ ] **Step 3: Write the function**

Append to `supabase/schema.sql` after the `select_ping_tier` block:

```sql
-- The public share path. SECURITY DEFINER because an anonymous caller has no
-- JWT, so auth.uid() and therefore current_team_id() are NULL and every RLS
-- policy denies. The share token IS the authorization: 256 bits of entropy,
-- revocable, and scoped to exactly one monitor and one window.
--
-- Deliberately narrow: one TEXT parameter, no dynamic SQL, pinned search_path,
-- and monitors.url is never selected — the redaction is enforced here, in SQL,
-- not in the React component that renders the result.
CREATE OR REPLACE FUNCTION get_shared_view(token TEXT)
RETURNS TABLE (
  view_name TEXT,
  monitor_name TEXT,
  monitor_status TEXT,
  window_from TIMESTAMPTZ,
  window_to TIMESTAMPTZ,
  ts TIMESTAMPTZ,
  response_time_ms NUMERIC,
  min_time_ms INTEGER,
  max_time_ms INTEGER,
  p95_time_ms INTEGER,
  sample_count INTEGER,
  source_tier TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  snap_from TIMESTAMPTZ;
  snap_to TIMESTAMPTZ;
BEGIN
  SELECT sv.name AS v_name,
         sv.team_id,
         sv.monitor_id,
         (sv.configuration->>'from')::TIMESTAMPTZ AS w_from,
         (sv.configuration->>'to')::TIMESTAMPTZ AS w_to,
         m.name AS m_name,
         m.status AS m_status
    INTO v
    FROM saved_views sv
    JOIN monitors m ON m.id = sv.monitor_id
   WHERE sv.share_token = token
     AND sv.revoked_at IS NULL
     AND m.is_deleted = false;

  -- One empty result for unknown, revoked, and deleted alike: the caller learns
  -- nothing about which case it hit.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Retention coarsens the data under a fixed window. Without widening, a
  -- 02:00-06:00 window served by midnight-stamped daily buckets returns
  -- nothing at all — blank, not blurry.
  IF v.w_from < NOW() - INTERVAL '90 days' THEN
    snap_from := date_trunc('day', v.w_from);
    snap_to   := date_trunc('day', v.w_to) + INTERVAL '1 day';
  ELSIF v.w_from < NOW() - INTERVAL '7 days' THEN
    snap_from := date_trunc('hour', v.w_from);
    snap_to   := date_trunc('hour', v.w_to) + INTERVAL '1 hour';
  ELSE
    snap_from := v.w_from;
    snap_to   := v.w_to;
  END IF;

  RETURN QUERY
  SELECT
    v.v_name::TEXT,
    v.m_name::TEXT,
    v.m_status::TEXT,
    v.w_from,
    v.w_to,
    t.ts,
    t.response_time_ms,
    t.min_time_ms,
    t.max_time_ms,
    t.p95_time_ms,
    t.sample_count,
    t.source_tier
  FROM select_ping_tier_for_team(v.team_id, v.monitor_id, snap_from, snap_to) t;
END;
$$;

-- Functions are executable by PUBLIC by default; narrow that deliberately.
REVOKE ALL ON FUNCTION get_shared_view(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_shared_view(TEXT) TO anon, authenticated;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/integration/shared-view-security.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql tests/integration/shared-view-security.test.ts
git commit -m "feat: add get_shared_view, the token-authorized public read path"
```

---

### Task 8: Saved-view types, validation, and data layer

**Files:**
- Create: `src/web/lib/shared/validations/saved-view.ts`
- Create: `src/web/lib/server/data/saved-views.ts`
- Modify: `src/web/lib/shared/types.ts` (append)
- Test: `src/web/tests/saved-views.test.ts`

**Interfaces:**
- Consumes: `get_shared_view` (Task 7).
- Produces:
  - `createSavedViewSchema` — `{ monitorId: string; name: string; from: string; to: string }`
  - `SavedView` — `{ id, teamId, monitorId, name, from, to, shareToken, revokedAt, createdAt }`
  - `SharedView` — `{ viewName, monitorName, monitorStatus, from, to, sourceTier, points: SharedViewPoint[] }`
  - `SharedViewPoint` — `{ timestamp: string; responseTimeMs: number; p95Ms: number; sampleCount: number }`
  - `listSavedViews(db)`, `createSavedView(db, input, teamId)`, `revokeSavedView(db, id)`, `deleteSavedView(db, id)`, `getSharedView(db, token)`

- [ ] **Step 1: Write the failing tests**

Create `src/web/tests/saved-views.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createSavedViewSchema } from '../lib/shared/validations/saved-view';
import { toSavedView, toSharedView } from '../lib/server/data/saved-views';

describe('createSavedViewSchema', () => {
  const valid = {
    monitorId: '11111111-1111-1111-1111-111111111111',
    name: 'Feb outage',
    from: '2026-02-14T02:00:00.000Z',
    to: '2026-02-14T06:00:00.000Z',
  };

  it('accepts a well-formed window', () => {
    expect(createSavedViewSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a window that ends before it starts', () => {
    const result = createSavedViewSchema.safeParse({ ...valid, to: '2026-02-14T01:00:00.000Z' });
    expect(result.success).toBe(false);
  });

  it('rejects a zero-length window', () => {
    const result = createSavedViewSchema.safeParse({ ...valid, to: valid.from });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(createSavedViewSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
  });
});

describe('toSavedView', () => {
  it('lifts the window out of the configuration jsonb', () => {
    const view = toSavedView({
      id: 'v1',
      team_id: 't1',
      monitor_id: 'm1',
      name: 'Feb outage',
      configuration: { from: '2026-02-14T02:00:00.000Z', to: '2026-02-14T06:00:00.000Z' },
      share_token: 'a'.repeat(43),
      revoked_at: null,
      created_at: '2026-02-15T00:00:00.000Z',
    });

    expect(view.from).toBe('2026-02-14T02:00:00.000Z');
    expect(view.to).toBe('2026-02-14T06:00:00.000Z');
    expect(view.revokedAt).toBeNull();
  });
});

describe('toSharedView', () => {
  const rows = [
    {
      view_name: 'Feb outage',
      monitor_name: 'Checkout API',
      monitor_status: 'down',
      window_from: '2026-02-14T02:00:00.000Z',
      window_to: '2026-02-14T06:00:00.000Z',
      ts: '2026-02-14T02:30:00.000Z',
      response_time_ms: 412.4,
      min_time_ms: 400,
      max_time_ms: 430,
      p95_time_ms: 428,
      sample_count: 1,
      source_tier: 'raw',
    },
  ];

  it('folds repeated header columns into one object with a point list', () => {
    const shared = toSharedView(rows);
    expect(shared?.viewName).toBe('Feb outage');
    expect(shared?.monitorName).toBe('Checkout API');
    expect(shared?.points).toHaveLength(1);
    expect(shared?.points[0].responseTimeMs).toBe(412);
  });

  it('reports the coarsest tier present, so the page can say the data is approximate', () => {
    const mixed = [rows[0], { ...rows[0], source_tier: 'daily' }];
    expect(toSharedView(mixed)?.sourceTier).toBe('daily');
  });

  it('returns null for an unknown or revoked token, which yields zero rows', () => {
    expect(toSharedView([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/web && npm test -- tests/saved-views.test.ts`
Expected: FAIL — cannot resolve `../lib/shared/validations/saved-view`

- [ ] **Step 3: Add the types**

Append to `src/web/lib/shared/types.ts`:

```typescript
/** A pinned, absolute time window on one monitor, shareable by token. */
export interface SavedView {
  /** Unique saved view identifier (UUID v4) */
  id: string;
  /** Owning team identifier */
  teamId: string;
  /** Monitor the window belongs to */
  monitorId: string;
  /** Display name given by the creator */
  name: string;
  /** ISO 8601 window start — absolute, never relative */
  from: string;
  /** ISO 8601 window end */
  to: string;
  /** 43-char base64url token embedded in the public URL */
  shareToken: string;
  /** ISO 8601 timestamp the link was killed, or null while live */
  revokedAt: string | null;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
}

/** One point on a publicly shared chart. Carries no status code — rolled-up
 *  tiers have none, and the public page does not distinguish up from down. */
export interface SharedViewPoint {
  timestamp: string;
  responseTimeMs: number;
  p95Ms: number;
  sampleCount: number;
}

/** What an anonymous visitor gets. Note the absence of a URL field: the SQL
 *  function never returns monitors.url, so it cannot be rendered by mistake. */
export interface SharedView {
  viewName: string;
  monitorName: string;
  monitorStatus: MonitorStatus;
  from: string;
  to: string;
  /** Coarsest tier serving this window: 'raw' | 'hourly' | 'daily'. */
  sourceTier: string;
  points: SharedViewPoint[];
}
```

- [ ] **Step 4: Add the validation schema**

Create `src/web/lib/shared/validations/saved-view.ts`:

```typescript
import { z } from 'zod';

export const createSavedViewSchema = z
  .object({
    monitorId: z.string().uuid('A monitor is required'),
    name: z.string().min(1, 'Name is required').max(255, 'Name must not exceed 255 characters'),
    from: z.string().datetime('Window start must be an ISO 8601 timestamp'),
    to: z.string().datetime('Window end must be an ISO 8601 timestamp'),
  })
  // Windows are absolute and pinned, so an inverted or empty one is never a
  // transient UI state — it is always a bug worth rejecting at the boundary.
  .refine((v) => new Date(v.to) > new Date(v.from), {
    message: 'Window end must be after its start',
    path: ['to'],
  });

export type CreateSavedViewSchema = z.infer<typeof createSavedViewSchema>;
```

- [ ] **Step 5: Add the data layer**

Create `src/web/lib/server/data/saved-views.ts`:

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MonitorStatus, SavedView, SharedView } from '../../shared/types';
import { createSavedViewSchema } from '../../shared/validations/saved-view';

const VIEW_COLUMNS =
  'id, team_id, monitor_id, name, configuration, share_token, revoked_at, created_at';

interface SavedViewRow {
  id: string;
  team_id: string;
  monitor_id: string;
  name: string;
  configuration: { from?: string; to?: string };
  share_token: string;
  revoked_at: string | null;
  created_at: string;
}

export function toSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    teamId: row.team_id,
    monitorId: row.monitor_id,
    name: row.name,
    from: row.configuration?.from ?? '',
    to: row.configuration?.to ?? '',
    shareToken: row.share_token,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export interface SharedViewRow {
  view_name: string;
  monitor_name: string;
  monitor_status: string;
  window_from: string;
  window_to: string;
  ts: string;
  response_time_ms: number;
  min_time_ms: number;
  max_time_ms: number;
  p95_time_ms: number;
  sample_count: number;
  source_tier: string;
}

// Coarsest wins: if any point came from daily buckets, the whole chart is only
// as trustworthy as daily buckets, and the page says so.
const TIER_RANK: Record<string, number> = { raw: 0, hourly: 1, daily: 2 };

/**
 * Folds the function's flat rows — which repeat the view header on every point —
 * into one object. Returns null for zero rows, which is what an unknown, revoked,
 * or deleted-monitor token yields; the caller renders a 404, not an error.
 */
export function toSharedView(rows: SharedViewRow[]): SharedView | null {
  if (rows.length === 0) return null;
  const head = rows[0];

  const sourceTier = rows.reduce(
    (worst, r) => ((TIER_RANK[r.source_tier] ?? 0) > (TIER_RANK[worst] ?? 0) ? r.source_tier : worst),
    head.source_tier
  );

  return {
    viewName: head.view_name,
    monitorName: head.monitor_name,
    monitorStatus: (head.monitor_status === 'paused'
      ? 'unknown'
      : head.monitor_status) as MonitorStatus,
    from: head.window_from,
    to: head.window_to,
    sourceTier,
    points: rows.map((r) => ({
      timestamp: r.ts,
      responseTimeMs: Math.round(Number(r.response_time_ms)),
      p95Ms: r.p95_time_ms,
      sampleCount: r.sample_count,
    })),
  };
}

/** Lists the signed-in team's saved views. Row level security scopes the result. */
export async function listSavedViews(db: SupabaseClient): Promise<SavedView[]> {
  const { data, error } = await db
    .from('saved_views')
    .select(VIEW_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toSavedView);
}

/**
 * Validates and inserts a saved view. share_token is omitted deliberately — the
 * column defaults to gen_share_token(), so the secret is generated in the
 * database and never passes through application code.
 */
export async function createSavedView(
  db: SupabaseClient,
  input: unknown,
  teamId: string
): Promise<SavedView> {
  const parsed = createSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid saved view');
  }

  const { data, error } = await db
    .from('saved_views')
    .insert({
      team_id: teamId,
      monitor_id: parsed.data.monitorId,
      name: parsed.data.name,
      configuration: { from: parsed.data.from, to: parsed.data.to },
    })
    .select(VIEW_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toSavedView(data);
}

/** Kills a share link without destroying the window. Idempotent. */
export async function revokeSavedView(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db
    .from('saved_views')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id');

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Hard delete — saved views carry no history worth soft-deleting. */
export async function deleteSavedView(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db.from('saved_views').delete().eq('id', id).select('id');

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/**
 * The anonymous read. `db` must be an anon-key client, not a session-bound one —
 * this runs for visitors with no account. Authorization is the token itself,
 * checked inside get_shared_view.
 */
export async function getSharedView(
  db: SupabaseClient,
  token: string
): Promise<SharedView | null> {
  const { data, error } = await db.rpc('get_shared_view', { token });

  if (error) throw new Error(error.message);
  return toSharedView((data ?? []) as SharedViewRow[]);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src/web && npm test -- tests/saved-views.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/web/lib src/web/tests/saved-views.test.ts
git commit -m "feat: add saved view types, validation, and data layer"
```

---

### Task 9: Server Actions and the anon Supabase client

**Files:**
- Create: `src/web/lib/server/actions/saved-views.ts`
- Modify: `src/web/lib/server/supabase.ts` (append `supabaseAnon`)

**Interfaces:**
- Consumes: `listSavedViews`, `createSavedView`, `revokeSavedView`, `deleteSavedView` (Task 8), `getSessionUser` (`lib/server/supabase.ts:41`).
- Produces: `createSavedViewAction(input): Promise<ActionResult<SavedView>>`, `revokeSavedViewAction(id): Promise<ActionResult>`, `deleteSavedViewAction(id): Promise<ActionResult>`, and `supabaseAnon(): SupabaseClient`.

- [ ] **Step 1: Add the anon client**

Append to `src/web/lib/server/supabase.ts`:

```typescript
/**
 * Session-free client using the public anon key. For pages served to visitors
 * with no account — currently only /share/[token], where authorization is the
 * token itself, checked inside get_shared_view. Carries no elevated privilege:
 * every RLS policy still applies, which is exactly why the share path needs a
 * SECURITY DEFINER function rather than a direct table read.
 */
export function supabaseAnon() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 2: Add the actions**

Create `src/web/lib/server/actions/saved-views.ts`:

```typescript
'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { getSessionUser, supabaseServer } from '../supabase';
import { createSavedView, deleteSavedView, revokeSavedView } from '../data/saved-views';
import type { ActionResult, SavedView } from '../../shared/types';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

/**
 * Saves a pinned window for the signed-in team. Mirrors createWebhookAction:
 * saved_views.team_id has no database default, so the team comes from the
 * session and row level security rejects any attempt to name a different one.
 */
export async function createSavedViewAction(input: unknown): Promise<ActionResult<SavedView>> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Not authenticated' };

    const view = await createSavedView(supabaseServer(), input, user.teamId);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: view };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/** Kills a live share link. The saved window survives. */
export async function revokeSavedViewAction(id: string): Promise<ActionResult> {
  try {
    const revoked = await revokeSavedView(supabaseServer(), id);
    if (!revoked) return { ok: false, error: 'View not found or already revoked' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/** Removes the view entirely. */
export async function deleteSavedViewAction(id: string): Promise<ActionResult> {
  try {
    const deleted = await deleteSavedView(supabaseServer(), id);
    if (!deleted) return { ok: false, error: 'View not found' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}
```

- [ ] **Step 3: Verify the build typechecks**

Run: `cd src/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/lib/server
git commit -m "feat: add saved view server actions and a session-free anon client"
```

---

### Task 10: The public share page

**Files:**
- Create: `src/web/app/share/[token]/page.tsx`
- Modify: `src/web/middleware.ts:62-69` (comment only)

**Interfaces:**
- Consumes: `getSharedView` (Task 8), `supabaseAnon` (Task 9), `TimeSeriesChart` (`src/web/components/monitors/time-series-chart.tsx`), `StatusBadge` (`src/web/components/monitors/status-badge.tsx`).
- Produces: the route `/share/<token>`.

- [ ] **Step 1: Record why the route is unguarded**

In `src/web/middleware.ts`, extend the comment above `matcher` with:

```typescript
  // /share/:token is deliberately absent: it is the public read path and must
  // work with no session. Its authorization is the token, enforced inside the
  // get_shared_view SQL function, not here.
```

- [ ] **Step 2: Write the page**

Create `src/web/app/share/[token]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getSharedView } from '@/lib/server/data/saved-views';
import { supabaseAnon } from '@/lib/server/supabase';
import { StatusBadge } from '@/components/monitors/status-badge';
import { TimeSeriesChart } from '@/components/monitors/time-series-chart';
import { formatDate } from '@/lib/shared/utils';

// Token-scoped and retention-sensitive — never prerender or cache.
export const dynamic = 'force-dynamic';

const TIER_NOTE: Record<string, string> = {
  hourly: 'Showing hourly averages — raw samples for this window have been rolled up.',
  daily: 'Showing daily averages. Percentiles at this range are approximate.',
};

/**
 * Public, session-free view of one pinned window. Deliberately shows the monitor
 * name but not its URL: get_shared_view does not return one, so there is nothing
 * here to leak even if this component were changed carelessly.
 */
export default async function SharedViewPage({ params }: { params: { token: string } }) {
  const shared = await getSharedView(supabaseAnon(), params.token).catch((error: unknown) => {
    console.error('Failed to load shared view:', error instanceof Error ? error.message : error);
    return null;
  });

  // Unknown, revoked, and purged all land here — the visitor learns nothing
  // about which, matching what the SQL function chooses to reveal.
  if (!shared) {
    notFound();
  }

  const metrics = shared.points.map((point) => ({
    timestamp: point.timestamp,
    responseTimeMs: point.responseTimeMs,
    statusCode: null,
    isUp: true,
  }));

  return (
    <div className="min-h-screen bg-background text-slate-100 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">
              {shared.monitorName}
            </h1>
            <StatusBadge status={shared.monitorStatus} />
          </div>
          <p className="text-sm text-slate-400">{shared.viewName}</p>
          <p className="text-xs text-slate-500 font-mono">
            {formatDate(shared.from)} — {formatDate(shared.to)}
          </p>
          {TIER_NOTE[shared.sourceTier] && (
            <p className="text-[11px] text-amber-400/90">{TIER_NOTE[shared.sourceTier]}</p>
          )}
        </div>

        <TimeSeriesChart metrics={metrics} />

        <p className="text-[11px] text-slate-600 text-center">Shared from UptimeKit</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks and builds**

Run: `cd src/web && npx tsc --noEmit && npm run build`
Expected: no errors, and `/share/[token]` listed as a dynamic route (`ƒ`) in the build output.

- [ ] **Step 4: Verify end to end in a browser**

With the dashboard running (`cd src/web && npm run dev`) and a saved view seeded into the database, open `http://localhost:3001/share/<token>` **in a private window with no session**. Expected: the chart renders, the monitor name shows, and the target URL appears nowhere — confirm via View Source, not just the rendered page. Then set `revoked_at` on that row and reload: expected 404.

- [ ] **Step 5: Commit**

```bash
git add src/web/app/share src/web/middleware.ts
git commit -m "feat: add the public /share/[token] page"
```

---

### Task 11: Save and manage UI

**Files:**
- Create: `src/web/components/monitors/save-view-button.tsx`
- Create: `src/web/components/settings/saved-view-list.tsx`
- Modify: `src/web/components/monitors/monitor-detail-view.tsx`
- Modify: `src/web/app/dashboard/settings/page.tsx`

**Interfaces:**
- Consumes: `createSavedViewAction`, `revokeSavedViewAction`, `deleteSavedViewAction` (Task 9), `listSavedViews` (Task 8).
- Produces: `<SaveViewButton monitorId from to />` and `<SavedViewList initialViews />`.

- [ ] **Step 1: Write the save button**

Create `src/web/components/monitors/save-view-button.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { createSavedViewAction } from '@/lib/server/actions/saved-views';

/**
 * Saves the currently displayed window and hands back a public link.
 * The window is captured at click time and pinned — the whole point is that
 * the link keeps showing this window, not "the last four hours" forever.
 */
export function SaveViewButton({
  monitorId,
  from,
  to,
}: {
  monitorId: string;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const outcome = await createSavedViewAction({ monitorId, name, from, to });
    setSaving(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setShareUrl(`${window.location.origin}/share/${outcome.data.shareToken}`);
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border text-slate-300 text-xs font-semibold rounded-lg transition-colors"
      >
        <Share2 className="h-3.5 w-3.5" /> Share this window
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 bg-surface border border-surface-border rounded-xl p-4 shadow-2xl space-y-3">
          {shareUrl ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-200">Anyone with this link can view it</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 min-w-0 px-2.5 py-1.5 bg-background border border-surface-border rounded-lg text-[11px] text-slate-300 font-mono"
                />
                <button
                  onClick={handleCopy}
                  aria-label="Copy share link"
                  className="p-2 text-slate-400 hover:text-brand-400 rounded-lg"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Revoke it any time from Notifications &rarr; Shared views.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-3">
              <label className="block text-[11px] font-medium text-slate-400">
                Name this window
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Feb 14 checkout outage"
                  className="mt-1 w-full px-2.5 py-1.5 bg-background border border-surface-border rounded-lg text-xs text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </label>
              {error && <p className="text-[11px] text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create share link'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it and label the tier**

In `src/web/components/monitors/monitor-detail-view.tsx`:

Import the button and add window state, since the component currently recomputes bounds on demand and never keeps them:

```tsx
import { SaveViewButton } from './save-view-button';
```

Add alongside the other `useState` calls:

```tsx
  // Kept in state so the share button pins the window actually on screen.
  const initialBounds = calculateTimestamps(currentPreset);
  const [window_, setWindow] = useState({
    from: searchParams.get('from') ?? initialBounds.from,
    to: searchParams.get('to') ?? initialBounds.to,
  });
```

In `handleSelectPreset`, immediately after `from` and `to` are resolved, add:

```tsx
    setWindow({ from, to });
```

Then in the "Performance History" header row, place the button before the picker:

```tsx
          <div className="flex items-center gap-2">
            <SaveViewButton monitorId={monitor.id} from={window_.from} to={window_.to} />
            <TimeRangePicker selectedPreset={preset} onSelectPreset={handleSelectPreset} />
          </div>
```

- [ ] **Step 3: Write the manage list**

Create `src/web/components/settings/saved-view-list.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Link2Off, Share2, Trash2 } from 'lucide-react';
import type { SavedView } from '@/lib/shared/types';
import { formatDate } from '@/lib/shared/utils';
import { deleteSavedViewAction, revokeSavedViewAction } from '@/lib/server/actions/saved-views';

/** Lists a team's shared windows with copy, revoke, and delete. */
export function SavedViewList({ initialViews }: { initialViews: SavedView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (view: SavedView) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${view.shareToken}`);
    setCopiedId(view.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const run = async (id: string, fn: () => Promise<{ ok: boolean }>) => {
    setBusyId(id);
    try {
      const outcome = await fn();
      if (outcome.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (initialViews.length === 0) {
    return (
      <div className="bg-surface border border-surface-border border-dashed rounded-2xl p-10 text-center space-y-2">
        <Share2 className="h-8 w-8 text-slate-600 mx-auto" />
        <p className="text-sm font-semibold text-slate-300">No shared views</p>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Open a monitor, pick a time window, and choose “Share this window” to create a public
          link.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-surface-border rounded-2xl divide-y divide-surface-border overflow-hidden">
      {initialViews.map((view) => (
        <div key={view.id} className="p-4 flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200 truncate">{view.name}</span>
              {view.revokedAt && (
                <span className="px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-[11px] font-semibold">
                  Revoked
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 font-mono">
              {formatDate(view.from)} — {formatDate(view.to)}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!view.revokedAt && (
              <>
                <button
                  onClick={() => handleCopy(view)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover hover:bg-brand-600/20 border border-surface-border text-slate-300 text-xs font-semibold rounded-lg transition-colors"
                >
                  {copiedId === view.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === view.id ? 'Copied' : 'Copy link'}
                </button>
                <button
                  onClick={() => run(view.id, () => revokeSavedViewAction(view.id))}
                  disabled={busyId === view.id}
                  aria-label="Revoke share link"
                  className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Link2Off className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={() => run(view.id, () => deleteSavedViewAction(view.id))}
              disabled={busyId === view.id}
              aria-label="Delete saved view"
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Render it on the settings page**

In `src/web/app/dashboard/settings/page.tsx`, add the import and fetch, then render below `<WebhookList />`:

```tsx
import { listSavedViews } from '@/lib/server/data/saved-views';
import { SavedViewList } from '@/components/settings/saved-view-list';
```

```tsx
  let views: Awaited<ReturnType<typeof listSavedViews>> = [];
  try {
    views = await listSavedViews(supabaseServer());
  } catch (error: unknown) {
    console.error('Failed to fetch saved views:', error instanceof Error ? error.message : error);
  }
```

```tsx
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-100">Shared views</h2>
        <SavedViewList initialViews={views} />
      </div>
```

- [ ] **Step 5: Verify it builds and works**

Run: `cd src/web && npx tsc --noEmit && npm run build`
Expected: no errors.

Then with `npm run dev`: open a monitor, pick a custom window, click **Share this window**, name it, copy the link, and open it in a private window. Expected: the same window renders with no login. Go to Notifications, revoke it, reload the private window. Expected: 404.

- [ ] **Step 6: Commit**

```bash
git add src/web/components src/web/app/dashboard/settings/page.tsx
git commit -m "feat: add save-and-share UI and shared view management"
```

---

### Task 12: Purge revokes shared links, and remove the tautological test

A soft-deleted monitor has its logs purged. Without this, every share link pointing at it serves a blank chart forever with no explanation.

**Files:**
- Modify: `src/worker/processors/purge-processor.ts:78-86`
- Modify: `tests/worker/purge-processor.test.ts`
- Delete: `tests/integration/quota-enforcement.test.ts`
- Modify: `supabase/schema.sql:10-17` (comment on the teams columns)

**Interfaces:**
- Consumes: `saved_views.revoked_at` (Task 6).
- Produces: no new exports. `processPurge` gains one statement inside its existing transaction.

- [ ] **Step 1: Write the failing test**

Append to `tests/worker/purge-processor.test.ts`:

```typescript
it('revokes share links for the purged monitor inside the same transaction', async () => {
  const queries: string[] = [];
  const client: any = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  const dbPool: any = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() };

  await new PurgeProcessor(dbPool).processPurge({ deletionQueueId: 'dq1', monitorId: 'm1' });

  const revoke = queries.findIndex((q) => q.includes('UPDATE saved_views'));
  expect(revoke).toBeGreaterThan(-1);
  // Inside the transaction: a link left live after its data is gone shows a
  // blank chart with no explanation.
  expect(queries.indexOf('COMMIT')).toBeGreaterThan(revoke);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/worker/purge-processor.test.ts`
Expected: FAIL — `expected -1 to be greater than -1`

- [ ] **Step 3: Add the statement**

In `src/worker/processors/purge-processor.ts`, between the daily-tier delete loop and the `deletion_queue` completion update:

```typescript
      // The logs behind any shared link are gone now. Revoke rather than leave a
      // live URL rendering an unexplained blank chart.
      await client.query(
        `UPDATE saved_views SET revoked_at = NOW(), updated_at = NOW()
         WHERE monitor_id = $1 AND revoked_at IS NULL`,
        [monitorId]
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/worker/purge-processor.test.ts`
Expected: PASS

- [ ] **Step 5: Remove the tautological quota test and label the columns**

```bash
git rm tests/integration/quota-enforcement.test.ts
```

That file read `supabase/schema.sql` and asserted `schema.sql` contains `quota_limits JSONB`. It cannot fail for any reason related to quotas, and its presence implies coverage that does not exist.

In `supabase/schema.sql`, above the `plan` and `quota_limits` columns on `teams`:

```sql
  -- Not enforced anywhere in application code yet. Kept because dropping shipped
  -- columns buys nothing; do not read them as a working billing tier.
```

- [ ] **Step 6: Run the full suite both sides**

Run: `npm test` from the root, then `npm test` from `src/web`
Expected: PASS in both, with the database-backed integration tests either passing (with `DATABASE_TEST_URL` set) or reported as skipped.

- [ ] **Step 7: Commit**

```bash
git add src/worker/processors/purge-processor.ts tests supabase/schema.sql
git commit -m "fix: revoke shared links when a monitor is purged; drop tautological quota test"
```

---

## Verification checklist

Before considering this plan complete, confirm each of the following by running the command, not by reading the code:

- [ ] `npm test` from the repo root passes.
- [ ] `npm test` from `src/web` passes.
- [ ] `npx tsc --noEmit` passes in both projects.
- [ ] `cd src/web && npm run build` succeeds.
- [ ] `supabase/schema.sql` applies cleanly to a fresh database, and applies a **second** time with no error and no duplicate `cron.job` row.
- [ ] With `DATABASE_TEST_URL` set, all six cases in `tests/integration/shared-view-security.test.ts` pass — in particular, the revoked, unknown, and soft-deleted cases each return zero rows.
- [ ] A share link opened in a browser with no session renders the chart, and the monitor's URL appears nowhere in the page source.
