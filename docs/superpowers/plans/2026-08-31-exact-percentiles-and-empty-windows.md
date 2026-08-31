# Exact Daily Percentiles & Renderable Empty Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two parked items from the concept-gap branch — make daily percentiles exact instead of percentiles-of-percentiles, and make a valid share link with an empty window render its view instead of returning 404.

**Architecture:** Task 1 rests on one observation that invalidates the parked reasoning: the `ponytail:` comment claims "the raw rows are gone by day 7", but the raw purge deletes `timestamp < NOW() - 7 days` and the daily rollup for day D runs at D+1 — so raw is still present, and exact percentiles need no sketch and no extension, just a different source table. Task 2 makes `get_shared_view` return one metadata row for a valid view even when the series is empty, via `LEFT JOIN LATERAL … ON TRUE`, while keeping unknown, revoked, and deleted-monitor tokens at zero rows.

**Tech Stack:** Postgres 17 (Supabase), Node 22, TypeScript (`module: NodeNext`, CommonJS at the root), `pg`, Next.js 14 App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-closing-concept-gaps-design.md` (on disk, untracked). Both items are listed there as non-goals; this plan deliberately reverses both, at the user's explicit request. Where this plan and that spec disagree, this plan wins.

## Global Constraints

- **`DATABASE_URL` in `.env` points at a REAL production Supabase project, and that project is currently PAUSED.** Never run a test, migration, script, or write against it. Database work uses `DATABASE_TEST_URL` naming the local throwaway: `postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test`.
- `supabase/schema.sql` is the only migration mechanism, applied by hand, and MUST stay idempotent. New columns are added with `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, never by editing the `CREATE TABLE` body, because the table already exists on deployed projects.
- The pg_cron region must remain the LAST thing in `supabase/schema.sql`, fenced by `-- @local-test:strip-start (pg_cron)` / `-- @local-test:strip-end`. `tests/integration/partitioning.test.ts` asserts the file ends with the closing sentinel — do not append anything after it.
- All four functions in the definer chain pin `pg_temp` in their `search_path`. Do not remove or narrow that on any function you touch.
- `get_shared_view` must never select `monitors.url`. The redaction is enforced by the function's return shape, in SQL, not in React.
- Root and `src/web` are separate npm projects with separate test commands. Task 1 touches only the root; Task 2 touches both.
- **Do not merge, push, rebase, or open a PR.** Commit to the current branch (`feat/team-webhooks-and-worker-fixes`) only. The user handles integration personally.
- Ponytail mode: shortest diff that actually works, stdlib/native first, no speculative abstraction. Deliberate shortcuts get a `ponytail:` comment naming the ceiling and upgrade path.

---

### Task 1: Compute daily percentiles from raw data when it is still complete

**Context for the implementer:** `src/worker/processors/rollup-processor.ts` rolls hourly buckets into daily ones. Its percentile columns take `PERCENTILE_CONT` over 24 *hourly percentile values* — a percentile of percentiles, with unbounded error, presented to the user as a percentile. A `ponytail:` comment justifies this with "the raw rows are gone by day 7."

That justification is wrong for the path that actually runs. The raw retention purge (`rollup-processor.ts`, in the `raw_to_hourly` branch) deletes `timestamp < (NOW() - INTERVAL '7 days')`, and the daily rollup for a given day runs about a day later. The raw rows for that day are still there. Exact daily percentiles need no t-digest and no extension — just `ping_logs_raw` instead of `ping_logs_hourly` as the percentile source.

The hazard is partial raw coverage. A day sitting near the 7-day boundary, or a backfill of an older day, may have *some* raw rows left. Computing percentiles from a partial sample is silently wrong in a way the approximation is not. So raw is used only when it is provably complete: the raw row count for the day must equal the summed `total_pings` from the hourly buckets. Any mismatch falls back to the existing approximation, and the row records which source was used.

Do **not** change how `total_pings`, `successful_pings`, `avg_response_time_ms`, `min_response_time_ms`, or `max_response_time_ms` are computed. `SUM`, `MIN` and `MAX` are exactly mergeable and the weighted average is already correct.

**Files:**
- Modify: `supabase/schema.sql` (the `ping_logs_daily` area, around line 153-170 — add the column via `ALTER TABLE`, placed after the `CREATE INDEX` for that table)
- Modify: `src/worker/processors/rollup-processor.ts` (the `hourly_to_daily` branch)
- Test: `tests/integration/daily-percentiles.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a new column `ping_logs_daily.percentile_source TEXT NOT NULL DEFAULT 'hourly_approx'`, values `'raw'` or `'hourly_approx'`. Task 2 does not read it.

- [ ] **Step 1: Read the current rollup branch and confirm the retention claim**

```bash
sed -n '125,180p' src/worker/processors/rollup-processor.ts
grep -n "DELETE FROM ping_logs_raw" src/worker/processors/rollup-processor.ts
sed -n '150,172p' supabase/schema.sql
```

Confirm the raw purge is `timestamp < (NOW() - INTERVAL '7 days')` and that the `hourly_to_daily` percentile columns currently read `p50_response_time_ms` / `p95_response_time_ms` / `p99_response_time_ms` from `ping_logs_hourly`.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/daily-percentiles.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';

// Same guard shape as tests/integration/shared-view-security.test.ts.
const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('daily percentiles', () => {
  let client: Client;
  let teamId: string;
  let monitorId: string;
  let day: string;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);
    await client.query("SET TIME ZONE 'UTC'");

    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('pctl') RETURNING id`
    );
    teamId = team.rows[0].id;

    const monitor = await client.query<{ id: string }>(
      `INSERT INTO monitors (team_id, name, url) VALUES ($1, 'pctl', 'https://example.com') RETURNING id`,
      [teamId]
    );
    monitorId = monitor.rows[0].id;

    // Two days back: inside the 7-day raw retention window, so raw is complete.
    day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.query('DELETE FROM ping_logs_daily WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM ping_logs_hourly WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM ping_logs_raw WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM monitors WHERE team_id = $1', [teamId]);
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      await client.end();
    }
  });

  it('takes daily percentiles from raw rows, not from percentiles of hourly percentiles', async () => {
    // Two hours, deliberately skewed so the two methods disagree loudly.
    // Hour A: 99 pings at 100ms.  Hour B: 1 ping at 10000ms.
    // True p95 over all 100 samples = 100ms (the 10000 sits at the very top).
    // Percentile-of-percentiles over the two hourly p95s (100, 10000) = 9505.
    for (let i = 0; i < 99; i++) {
      await client.query(
        `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code, is_up)
         VALUES ($1, $2, $3::timestamptz + make_interval(secs => $4), 100, 200, true)`,
        [teamId, monitorId, `${day}T01:00:00Z`, i]
      );
    }
    await client.query(
      `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code, is_up)
       VALUES ($1, $2, $3::timestamptz, 10000, 200, true)`,
      [teamId, monitorId, `${day}T02:00:00Z`]
    );

    await client.query(
      `INSERT INTO ping_logs_hourly
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES
         ($1, $2, $3::timestamptz,  99, 99,   100,   100,   100,   100,   100,   100),
         ($1, $2, $4::timestamptz,   1,  1, 10000, 10000, 10000, 10000, 10000, 10000)`,
      [teamId, monitorId, `${day}T01:00:00Z`, `${day}T02:00:00Z`]
    );

    const { RollupProcessor } = await import('../../src/worker/processors/rollup-processor');
    const processor = new RollupProcessor(client as never);
    const result = await processor.processRollup({
      rollupType: 'hourly_to_daily',
      timeWindow: `${day}T00:00:00.000Z`,
    });
    expect(result.status).toBe('completed');

    const { rows } = await client.query<{
      p95_response_time_ms: number;
      percentile_source: string;
      total_pings: number;
    }>(
      `SELECT p95_response_time_ms, percentile_source, total_pings
         FROM ping_logs_daily WHERE team_id = $1 AND monitor_id = $2`,
      [teamId, monitorId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].total_pings).toBe(100);
    expect(rows[0].percentile_source).toBe('raw');
    // Exact p95 of 99x100ms + 1x10000ms. The old percentile-of-percentiles
    // answer was ~9505 — if this assertion reads anything near that, the
    // percentiles are still coming from the hourly table.
    expect(rows[0].p95_response_time_ms).toBeLessThan(1000);
  });

  it('falls back to the hourly approximation when raw coverage is incomplete', async () => {
    // Same shape, but only SOME of the raw rows survive — exactly what a day
    // straddling the 7-day purge boundary looks like. A percentile computed
    // from a partial sample is silently wrong, so it must not be used.
    const day2 = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

    await client.query(
      `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code, is_up)
       VALUES ($1, $2, $3::timestamptz, 100, 200, true)`,
      [teamId, monitorId, `${day2}T01:00:00Z`]
    );

    await client.query(
      `INSERT INTO ping_logs_hourly
         (team_id, monitor_id, bucket_start, total_pings, successful_pings,
          avg_response_time_ms, min_response_time_ms, max_response_time_ms,
          p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3::timestamptz, 50, 50, 100, 100, 100, 100, 777, 900)`,
      [teamId, monitorId, `${day2}T01:00:00Z`]
    );

    const { RollupProcessor } = await import('../../src/worker/processors/rollup-processor');
    const processor = new RollupProcessor(client as never);
    await processor.processRollup({
      rollupType: 'hourly_to_daily',
      timeWindow: `${day2}T00:00:00.000Z`,
    });

    const { rows } = await client.query<{ p95_response_time_ms: number; percentile_source: string }>(
      `SELECT p95_response_time_ms, percentile_source
         FROM ping_logs_daily
        WHERE team_id = $1 AND monitor_id = $2 AND bucket_start = $3::timestamptz`,
      [teamId, monitorId, `${day2}T00:00:00Z`]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].percentile_source).toBe('hourly_approx');
    expect(rows[0].p95_response_time_ms).toBe(777);
  });
});
```

**Before running, check the fixture columns.** `ping_logs_raw`, `ping_logs_hourly`, `monitors` and `teams` may have `NOT NULL` columns without defaults beyond those inserted above (`sed -n '100,170p' supabase/schema.sql`). Add whatever else is required to the fixtures. **Never relax the schema to fit a test.**

Note `new RollupProcessor(client as never)` — the processor's constructor takes a `Pool`, and a `Client` satisfies the `.query`/`.connect` surface it uses at runtime. If `processRollup` calls `dbPool.connect()` and a bare `Client` cannot serve it, use a real `Pool` pointed at `DATABASE_TEST_URL` instead and close it in `afterAll`. Decide from the code, not by guessing.

- [ ] **Step 3: Run the test to verify it fails**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run tests/integration/daily-percentiles.test.ts
```

Expected: both tests FAIL. The first because `percentile_source` does not exist yet (an error naming that column), the second likewise.

- [ ] **Step 4: Add the column to `supabase/schema.sql`**

Immediately after `CREATE INDEX IF NOT EXISTS idx_ping_daily_team_time ON ping_logs_daily (team_id, bucket_start);`, add:

```sql
-- Records where a daily row's percentiles actually came from. 'raw' means they
-- are exact: the day's raw rows were still present AND complete (their count
-- matched the hourly buckets' summed total_pings), so PERCENTILE_CONT ran over
-- the real sample. 'hourly_approx' means the raw rows were gone or partial and
-- the row carries percentiles OF hourly percentiles, whose error is unbounded.
-- ALTER rather than a CREATE TABLE edit: the table already exists on deployed
-- projects, and schema.sql must stay re-runnable.
ALTER TABLE ping_logs_daily
  ADD COLUMN IF NOT EXISTS percentile_source TEXT NOT NULL DEFAULT 'hourly_approx';

DO $$
BEGIN
  ALTER TABLE ping_logs_daily
    ADD CONSTRAINT ping_logs_daily_percentile_source_check
    CHECK (percentile_source IN ('raw', 'hourly_approx'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
```

- [ ] **Step 5: Rewrite the `hourly_to_daily` aggregate query**

In `src/worker/processors/rollup-processor.ts`, replace the `hourly_to_daily` `aggregateQuery` with:

```typescript
        const aggregateQuery = `
          WITH h AS (
            SELECT
              team_id,
              monitor_id,
              date_trunc('day', bucket_start) AS bucket_start,
              SUM(total_pings)::int AS total_pings,
              SUM(successful_pings)::int AS successful_pings,
              -- Weighted by ping count: see weightedAverage() in this file.
              -- NULLIF avoids the division-by-zero error when a day's hourly rows
              -- are all empty; COALESCE then turns that NULL back into 0 so the
              -- NOT NULL column is satisfied and this matches weightedAverage()'s
              -- all-zero-count case (which returns 0) exactly.
              COALESCE(ROUND(SUM(avg_response_time_ms::numeric * total_pings)
                    / NULLIF(SUM(total_pings), 0)), 0)::int AS avg_response_time_ms,
              MIN(min_response_time_ms)::int AS min_response_time_ms,
              MAX(max_response_time_ms)::int AS max_response_time_ms,
              -- Percentiles OF hourly percentiles. Kept only as the fallback for
              -- days whose raw rows have aged out or are partially purged.
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY p50_response_time_ms)::int AS approx_p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p95_response_time_ms)::int AS approx_p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY p99_response_time_ms)::int AS approx_p99
            FROM ping_logs_hourly
            WHERE bucket_start >= $1::timestamptz AND bucket_start < ($1::timestamptz + INTERVAL '1 day')
            GROUP BY team_id, monitor_id, date_trunc('day', bucket_start)
          )
          INSERT INTO ping_logs_daily (
            team_id, monitor_id, bucket_start, total_pings, successful_pings,
            avg_response_time_ms, min_response_time_ms, max_response_time_ms,
            p50_response_time_ms, p95_response_time_ms, p99_response_time_ms,
            percentile_source
          )
          SELECT
            h.team_id,
            h.monitor_id,
            h.bucket_start,
            h.total_pings,
            h.successful_pings,
            h.avg_response_time_ms,
            h.min_response_time_ms,
            h.max_response_time_ms,
            COALESCE(r.p50, h.approx_p50),
            COALESCE(r.p95, h.approx_p95),
            COALESCE(r.p99, h.approx_p99),
            CASE WHEN r.p95 IS NULL THEN 'hourly_approx' ELSE 'raw' END
          FROM h
          -- The raw rows for this day are still inside the 7-day retention window
          -- when the scheduled rollup runs, so the exact percentile is available
          -- and no mergeable sketch is needed. HAVING pins completeness rather
          -- than mere presence: a day straddling the purge boundary keeps SOME
          -- raw rows, and a percentile over a partial sample is silently wrong in
          -- a way the approximation is not. Count mismatch => fall back.
          LEFT JOIN LATERAL (
            SELECT
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)::int AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)::int AS p99
            FROM ping_logs_raw
            WHERE team_id = h.team_id
              AND monitor_id = h.monitor_id
              AND timestamp >= h.bucket_start
              AND timestamp < h.bucket_start + INTERVAL '1 day'
            HAVING COUNT(*) = h.total_pings AND COUNT(*) > 0
          ) r ON TRUE
          ON CONFLICT (team_id, monitor_id, bucket_start) DO UPDATE SET
            total_pings = EXCLUDED.total_pings,
            successful_pings = EXCLUDED.successful_pings,
            avg_response_time_ms = EXCLUDED.avg_response_time_ms,
            min_response_time_ms = EXCLUDED.min_response_time_ms,
            max_response_time_ms = EXCLUDED.max_response_time_ms,
            p50_response_time_ms = EXCLUDED.p50_response_time_ms,
            p95_response_time_ms = EXCLUDED.p95_response_time_ms,
            p99_response_time_ms = EXCLUDED.p99_response_time_ms,
            percentile_source = EXCLUDED.percentile_source
        `;
```

Then delete the now-false `ponytail:` comment that claimed "the raw rows are gone by day 7" — it is superseded by the comment above the `LEFT JOIN LATERAL`. Leave the file's other `ponytail:` comments alone.

- [ ] **Step 6: Run the test to verify it passes**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run tests/integration/daily-percentiles.test.ts
```

Expected: both tests PASS.

- [ ] **Step 7: Prove the first test discriminates**

Temporarily change the three `COALESCE(r.pNN, h.approx_pNN)` expressions back to `h.approx_pNN`, leaving everything else in place. Re-run.

Expected: the first test FAILS on `expect(rows[0].p95_response_time_ms).toBeLessThan(1000)`, reporting a value near 9505. Restore and confirm PASS. **If reverting does not turn it red, the test is worthless — say so and fix it rather than keeping it.**

- [ ] **Step 8: Run the whole root suite and the type check**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run
npx tsc --noEmit
```

Expected: all files pass with no skipped DB tests, `tsc` clean. Existing rollup tests must still pass unchanged — if one breaks, read it before editing it; a real regression is more likely than a stale test.

- [ ] **Step 9: Confirm the schema is still idempotent**

```bash
export PGPASSWORD=postgres
psql -h 127.0.0.1 -U postgres -d postgres -c "DROP DATABASE IF EXISTS uptimekit_pctl_check;"
psql -h 127.0.0.1 -U postgres -d postgres -c "CREATE DATABASE uptimekit_pctl_check;"
psql -h 127.0.0.1 -U postgres -d uptimekit_pctl_check -f tests/integration/helpers/bootstrap-local.sql
```

Then apply `supabase/schema.sql` to `uptimekit_pctl_check` **twice** through the same path the tests use (a short Node script calling `applySchema`, or `psql` with the pg_cron region removed). Both applies must succeed — the `ADD CONSTRAINT` in a `DO` block is the part that would fail on a second run if the exception handler is wrong. Drop the scratch database afterwards.

- [ ] **Step 10: Commit**

```bash
git add supabase/schema.sql src/worker/processors/rollup-processor.ts tests/integration/daily-percentiles.test.ts
git commit -m "feat: compute exact daily percentiles from raw rows when coverage is complete"
```

---

### Task 2: Render a valid share link whose window holds no data

**Context for the implementer:** `get_shared_view` returns one flat row per data point, with the view header repeated on each. When the pinned window contains no data — because retention purged it, or the monitor was quiet — the tier query returns nothing, so the function returns zero rows, and `toSharedView` returns `null`, and `src/web/app/share/[token]/page.tsx` renders `notFound()`. A perfectly valid link 404s.

This was parked deliberately: returning zero rows for unknown, revoked, and deleted-monitor tokens alike means the caller learns nothing about which case it hit, and distinguishing "valid but empty" reintroduces a token-existence oracle. The user has asked for it anyway, and the trade is defensible — the token is 43 characters of base64url over 256 bits of entropy, so an attacker cannot generate candidate tokens to ask about. An oracle you cannot query with a plausible guess is not a practical exposure. Write that reasoning into the function's comment; do not silently drop the old one.

**What must not change:** an unknown token, a revoked token, a token whose monitor is soft-deleted, and a token whose stored window is malformed must all still return **zero rows**. Only a valid, unrevoked, live-monitor view with an empty series gains a row.

**Files:**
- Modify: `supabase/schema.sql` (the `RETURN QUERY` at the end of `get_shared_view`, and the function's header comment)
- Modify: `src/web/lib/server/data/saved-views.ts` (`SharedViewRow`, `toSharedView`)
- Modify: `src/web/app/share/[token]/page.tsx`
- Modify: `tests/integration/shared-view-security.test.ts` (add the empty-window case; the existing zero-row cases stay)
- Modify: `src/web/tests/saved-views.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1. Both tasks edit `supabase/schema.sql`, in different regions — Task 1 near `ping_logs_daily` (~line 168), Task 2 inside `get_shared_view` (~line 556-575). Run Task 1 first and this is a clean edit.
- Produces: `SharedView.points` may now be an empty array. The `SharedView` type itself does not otherwise change.

- [ ] **Step 1: Read the three pieces you are changing**

```bash
sed -n '556,580p' supabase/schema.sql
sed -n '36,90p' src/web/lib/server/data/saved-views.ts
cat src/web/app/share/[token]/page.tsx
```

- [ ] **Step 2: Write the failing integration test**

Add to `tests/integration/shared-view-security.test.ts`, inside the existing suite. Follow the file's existing fixture helpers rather than inventing new ones — read the neighbouring cases first and reuse how they create a team, a monitor, and a saved view.

```typescript
  it('returns the view header, and no data points, for a valid token whose window is empty', async () => {
    // A pinned window with no pings in it. Before this change the function
    // returned zero rows here, indistinguishable from an unknown token, and the
    // page 404'd a link that was perfectly valid.
    const token = await createShareableView({
      // a window far from any seeded ping data
      from: '2019-01-01T00:00:00Z',
      to: '2019-01-01T04:00:00Z',
    });

    const { rows } = await client.query(`SELECT * FROM get_shared_view($1)`, [token]);

    expect(rows).toHaveLength(1);
    expect(rows[0].view_name).toBeTruthy();
    expect(rows[0].monitor_name).toBeTruthy();
    expect(rows[0].window_from).not.toBeNull();
    expect(rows[0].window_to).not.toBeNull();
    // The series columns are null — there is no point to describe.
    expect(rows[0].ts).toBeNull();
    expect(rows[0].response_time_ms).toBeNull();
    expect(rows[0].source_tier).toBeNull();
    // And the redaction still holds.
    expect(Object.keys(rows[0])).not.toContain('url');
  });

  it('still returns zero rows for unknown, revoked, and deleted-monitor tokens', async () => {
    // The empty-window change must not have widened any of these. This is the
    // assertion that keeps the new row from becoming a general oracle.
    const unknown = await client.query(`SELECT * FROM get_shared_view($1)`, ['no-such-token']);
    expect(unknown.rows).toHaveLength(0);
  });
```

Adapt `createShareableView` to whatever the file's existing helper is actually called; if there is no helper, inline the inserts the way the neighbouring cases do. Extend the second test to cover the revoked and deleted-monitor cases using the same fixtures those existing cases already build.

- [ ] **Step 3: Write the failing unit test**

Add to `src/web/tests/saved-views.test.ts`:

```typescript
  it('keeps the view header and returns no points when the series is empty', () => {
    const result = toSharedView([
      {
        view_name: 'Tuesday outage',
        monitor_name: 'api.example.com',
        monitor_status: 'up',
        window_from: '2026-08-01T02:00:00Z',
        window_to: '2026-08-01T06:00:00Z',
        ts: null,
        response_time_ms: null,
        min_time_ms: null,
        max_time_ms: null,
        p95_time_ms: null,
        sample_count: null,
        source_tier: null,
      },
    ]);

    expect(result).not.toBeNull();
    expect(result?.viewName).toBe('Tuesday outage');
    expect(result?.monitorName).toBe('api.example.com');
    expect(result?.points).toEqual([]);
  });

  it('still returns null for zero rows', () => {
    // Unknown, revoked and deleted-monitor tokens all land here.
    expect(toSharedView([])).toBeNull();
  });
```

- [ ] **Step 4: Run both tests to verify they fail**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run tests/integration/shared-view-security.test.ts
cd src/web && npx vitest run tests/saved-views.test.ts; cd ../..
```

Expected: the empty-window integration test FAILS with `expected length 1, received 0`; the new unit test FAILS on a TypeScript error about `null` not being assignable, or on `result` being `null`.

- [ ] **Step 5: Change the function's `RETURN QUERY`**

In `supabase/schema.sql`, replace the `RETURN QUERY` block at the end of `get_shared_view` with:

```sql
  -- LEFT JOIN LATERAL against a one-row anchor: a valid view always yields at
  -- least its header row, with the series columns NULL when the pinned window
  -- holds no data. Without this, a quiet or retention-emptied window returned
  -- zero rows and the page 404'd a link that was perfectly valid.
  --
  -- This does hand back a token-VALIDITY oracle, which the earlier design
  -- deliberately avoided. The trade is deliberate and bounded: share_token is
  -- 43 base64url characters over 256 bits from gen_random_bytes, so an attacker
  -- has no way to produce a candidate token to ask about, and an oracle that
  -- cannot be queried with a plausible guess is not a practical exposure. The
  -- cases that still reveal nothing are the ones that would matter — unknown,
  -- revoked, soft-deleted monitor and malformed window all return zero rows
  -- above, and must keep doing so.
  RETURN QUERY
  SELECT
    v.v_name::TEXT,
    v.m_name::TEXT,
    v.m_status::TEXT,
    w_from,
    w_to,
    t.ts,
    t.response_time_ms,
    t.min_time_ms,
    t.max_time_ms,
    t.p95_time_ms,
    t.sample_count,
    t.source_tier
  FROM (SELECT 1) AS anchor
  LEFT JOIN LATERAL
    select_ping_tier_for_team(v.team_id, v.monitor_id, snap_from, snap_to) t ON TRUE;
```

Leave everything above it — the `IF NOT FOUND THEN RETURN`, the malformed-window `EXCEPTION … RETURN`, the tenant-pinned join, the snapping, `SET search_path`, `SET TimeZone`, the `REVOKE`/`GRANT` pair — exactly as it is.

- [ ] **Step 6: Update the data layer**

In `src/web/lib/server/data/saved-views.ts`, widen the series fields on `SharedViewRow` to allow null, and make `toSharedView` drop header-only rows from `points`:

```typescript
export interface SharedViewRow {
  view_name: string;
  monitor_name: string;
  monitor_status: string;
  window_from: string;
  window_to: string;
  // Null on the header row a valid-but-empty window returns.
  ts: string | null;
  response_time_ms: number | null;
  min_time_ms: number | null;
  max_time_ms: number | null;
  p95_time_ms: number | null;
  sample_count: number | null;
  source_tier: string | null;
}
```

and inside `toSharedView`, after the existing `if (rows.length === 0) return null;` and `const head = rows[0];`:

```typescript
  // A valid view whose window holds no data comes back as a single header row
  // with every series column null. Zero rows still means unknown/revoked/deleted.
  const series = rows.filter((r) => r.ts !== null);

  const sourceTier = series.reduce(
    (worst, r) => ((TIER_RANK[r.source_tier ?? ''] ?? 0) > (TIER_RANK[worst] ?? 0) ? r.source_tier! : worst),
    series[0]?.source_tier ?? ''
  );
```

then build `points` from `series` rather than `rows`, leaving the rest of the returned object unchanged. Update the function's doc comment: zero rows still means unknown, revoked, or deleted-monitor; an empty `points` array now means a valid view over an empty window.

- [ ] **Step 7: Render the empty state**

In `src/web/app/share/[token]/page.tsx`, keep `notFound()` for a `null` result, and add an explicit empty state when `points.length === 0`. Render the view name, monitor name, status and window exactly as the populated case does, and in place of the chart a short line of copy such as:

> No response data was recorded in this window.

Match the file's existing markup and styling conventions — read the populated branch and mirror it rather than introducing a new layout. Do not add a dependency.

- [ ] **Step 8: Run both tests to verify they pass**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run tests/integration/shared-view-security.test.ts
cd src/web && npx vitest run tests/saved-views.test.ts; cd ../..
```

Expected: all pass, including every pre-existing security case in the integration file.

- [ ] **Step 9: Prove the security cases still discriminate**

This is the step that matters. Temporarily change the `IF NOT FOUND THEN RETURN;` guard in `get_shared_view` to fall through instead of returning, re-apply the schema to the test database, and re-run `tests/integration/shared-view-security.test.ts`.

Expected: the unknown/revoked/deleted-monitor cases go RED. Restore the guard, re-apply, confirm GREEN. Record the verbatim output. **If those cases stay green with the guard removed, they are not testing what they claim and must be fixed.**

- [ ] **Step 10: Run both suites, the type checks, and the web build**

```bash
export DATABASE_TEST_URL='postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test'
npx vitest run
npx tsc --noEmit
cd src/web && npx vitest run && npx tsc --noEmit && npm run build; cd ../..
```

Expected: everything passes and the production build succeeds.

- [ ] **Step 11: Commit**

```bash
git add supabase/schema.sql src/web/lib/server/data/saved-views.ts "src/web/app/share/[token]/page.tsx" tests/integration/shared-view-security.test.ts src/web/tests/saved-views.test.ts
git commit -m "feat: render a valid share link whose pinned window holds no data"
```

---

## Out of scope

Recorded so no implementer picks them up:

- **Applying `supabase/schema.sql` to the production Supabase project, and running `scripts/backfill-daily-rollups.ts` against it.** The project (`hhzjeqetgjdiqgqqcpzm`, "UptimeKit") is currently **paused/INACTIVE**, and this session has no write access to it. Both are the user's to perform.
- **Surfacing `percentile_source` in the dashboard UI.** The column records the provenance; plumbing it through `select_ping_tier` into the chart is separate work, and the chart already labels its `source_tier`.
- **Merging, pushing, rebasing, or opening a PR.** The user handles integration personally.
- **Backfilling `percentile_source` for existing daily rows.** They keep the `'hourly_approx'` default, which is accurate for how they were computed.
