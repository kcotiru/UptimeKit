# Closing the concept gaps: shared views + correctness & operations

**Date:** 2026-08-23
**Status:** Approved for planning
**Scope:** `supabase/schema.sql`, `src/worker`, `src/web`, `tests/`. Six gaps between the original UptimeKit concept and the shipped implementation.

## Problem

An audit of the codebase against the original product concept found one pillar entirely unbuilt and five defects that undermine the pillars that are built.

| Concept pillar | State |
| --- | --- |
| Users enter URLs; app pings them and logs response times | Built |
| Roll minute data into hourly averages after 7 days | Built (raw / hourly / daily tiers, daily partitions, retention deletes) |
| Separate Node polling service | Built (`src/worker`, BullMQ + Redis) |
| P95/P99 latency percentiles | Built, computed in Postgres at rollup time |
| Multi-tenant Team accounts | Built, enforced by row level security |
| **Save a graph window and share that exact view via a link** | **Not built.** `saved_views` exists in the schema; no code references it. |

The five defects:

1. **Daily averages are unweighted.** `rollup-processor.ts:132` uses `ROUND(AVG(avg_response_time_ms))` across 24 hourly rows, weighting an hour with 2 pings the same as an hour with 120.
2. **Daily percentiles are percentiles-of-percentiles.** `rollup-processor.ts:135-137` takes `PERCENTILE_CONT(0.95)` over 24 hourly p95 values. This is an approximation with unbounded error, presented to the user as a percentile.
3. **Partition runway expires.** `schema.sql:293-300` pre-creates partitions through `CURRENT_DATE + 30`. On day 31 every insert into `ping_logs_raw` fails with *no partition of relation found* and monitoring stops silently. `drop_expired_partitions()` exists but nothing calls it, so detached partitions accumulate forever.
4. **`timeoutMs` is fictional.** The create form collects it, `createMonitorSchema` validates it 1000-30000, `data/monitors.ts:11` displays a hardcoded 5000, and the worker ignores all of it in favour of a global 30s `DEFAULT_HTTP_TIMEOUT_MS`. Three numbers, no column.
5. **`teams.plan` / `teams.quota_limits` are unenforced,** and `tests/integration/quota-enforcement.test.ts` reads `schema.sql` and asserts that `schema.sql` contains the string `quota_limits JSONB`. It cannot fail for any quota-related reason.

## Goals

1. A team member can pin a specific time window on a monitor, save it, and share a URL that renders that exact window to someone with no account.
2. Rolled-up numbers are either correct or labelled as approximate. No silent wrongness.
3. The system does not stop recording data because a maintenance window elapsed.
4. Every setting the UI collects is a setting the worker honours.

## Non-goals

- No status-page product (branding, custom domains, multi-monitor pages).
- No change to the RLS model for authenticated users.
- No exact daily percentiles. Recovering those requires a mergeable sketch and is out of scope.
- No cleanup of the other schema-text-assertion tests in `tests/integration/`, beyond deleting the quota one.

## Decisions taken during design

| Question | Decision |
| --- | --- |
| Who can open a share link? | **Public.** Anyone with the URL, no session. |
| What does an anonymous visitor see? | **Monitor name, status, chart, window.** Never `monitors.url`. |
| Absolute or relative window? | **Absolute only.** The use case is an incident postmortem; a sliding window makes the link worthless. |
| Timeout mismatch | **Add a per-monitor column.** |
| `plan` / `quota_limits` | **Keep the columns, comment them as unenforced, delete the tautological test.** |

---

## Architecture: the public read path

An anonymous request carries no JWT, so `auth.uid()` is NULL, so `current_team_id()` (`schema.sql:33`) returns NULL, so every RLS policy denies. `select_ping_tier` is built on that function and therefore returns nothing for an anonymous caller.

### Approaches considered

**A. `SECURITY DEFINER` function keyed by the share token.** One function accepts the token, resolves the saved view, and returns that monitor's series. The token is the authorization; the function bypasses RLS deliberately and narrowly. **Chosen.**

**B. Service-role read inside the Next `/share` route.** No SQL work, but it places a service-role client on an unauthenticated code path. One bug in the token check becomes unrestricted database read. The `server-only` split exists specifically to confine that client to signup. **Rejected.**

**C. Anonymous RLS policy driven by a request GUC.** Pass the token as a PostgREST header and read it inside the policy. Brittle and hard to audit. **Rejected.**

### The function split

A `SECURITY DEFINER` function changes the effective *role*, not the session's JWT claims. `current_team_id()` still returns NULL inside it, so `get_shared_view()` cannot delegate to `select_ping_tier()`. Rather than duplicate the three-tier UNION, the query body is lifted into a function that takes the team as a parameter:

```
select_ping_tier_for_team(team_id, monitor_id, start, end)   -- the UNION body; SECURITY INVOKER
  |
  +-- select_ping_tier(monitor_id, start, end)               -- unchanged signature, passes current_team_id()
  |
  +-- get_shared_view(token)                                 -- SECURITY DEFINER, passes the view's stored team_id
```

One query body, two callers, no drift between the authenticated chart and the shared one.

`select_ping_tier_for_team` stays `SECURITY INVOKER`. An authenticated user calling it directly with another team's UUID still hits RLS on `ping_logs_*` and gets zero rows, so the parameter is not a hole. Called from inside `get_shared_view`, the invoker is the definer's role and RLS is bypassed as intended.

### Hardening `get_shared_view`

- `SET search_path = public`, no dynamic SQL, a single `TEXT` parameter.
- `REVOKE ALL FROM PUBLIC`, then `GRANT EXECUTE TO anon, authenticated`.
- Never selects `monitors.url`. The redaction is enforced in SQL, not in a React component.
- Filters `revoked_at IS NULL` and `monitors.is_deleted = false`.
- Returns zero rows for an unknown token. No distinction between "unknown", "revoked", and "deleted monitor" in the return shape.

Token comparison is a plain indexed equality and is not constant-time. With a 256-bit random token this is not a practical exposure.

### Retention interaction: window snapping

An absolute window plus tiered retention does not degrade gracefully, it goes **empty**. A shared 02:00-06:00 window, 90 days later, is served by daily buckets stamped 00:00, and `bucket_start BETWEEN '02:00' AND '06:00'` matches nothing.

`get_shared_view` therefore snaps the requested window outward to the serving tier's bucket boundary before querying:

| Window age | Snap |
| --- | --- |
| < 7 days | none (raw) |
| 7-90 days | floor start to the hour, ceil end to the hour |
| > 90 days | floor start to the day, ceil end to the day |

The page states the effective resolution when it is coarser than raw. No snapshotting, no extra storage.

---

## Data model

`saved_views` already exists. Three changes:

| Change | Rationale |
| --- | --- |
| `+ monitor_id UUID REFERENCES monitors(id)` | Promoted out of `configuration` jsonb. It is a real foreign key, and both the definer function and the purge path filter on it. |
| `+ revoked_at TIMESTAMPTZ` | Kill a leaked link without deleting the view. |
| `share_token` gains a default of `gen_share_token()` | 43-char base64url of 32 random bytes, generated in Postgres. 256-bit, unguessable, no enumeration. |

`configuration` jsonb retains only `{"from": "<iso>", "to": "<iso>"}`.

The existing `tenant_isolation_views` policy is unchanged. Owners manage views as `authenticated`; the anonymous path goes through the definer function and never touches the table directly.

### Purge interaction

Soft-deleting a monitor enqueues a purge that deletes all three tiers of its logs. Any share link pointing at that monitor would then serve a blank chart forever with no explanation. The purge transaction gains one statement:

```sql
UPDATE saved_views SET revoked_at = NOW() WHERE monitor_id = $1 AND revoked_at IS NULL
```

and `/share/[token]` renders an explicit "no longer available" state.

---

## Surface

- **Save** — a button on the monitor detail view, enabled when a window is selected. Prompts for a name, calls `createSavedViewAction`, returns the share URL for copying.
- **Manage** — a list under `/dashboard/settings`, following the `webhook-list.tsx` pattern: name, monitor, window, copy link, revoke, delete.
- **Public page** — `/share/[token]`, a Server Component, `dynamic = 'force-dynamic'`. The `middleware.ts` matcher covers only `/dashboard`, `/login`, `/register`, so the route is already reachable without a session; the matcher comment is updated to record that this is deliberate.

Deliberately skipped: editing a saved view (delete and re-save), folders or tags, view-count analytics, embedding.

---

## Correctness & operations

### Weighted daily average

```sql
ROUND(SUM(avg_response_time_ms::numeric * total_pings) / NULLIF(SUM(total_pings), 0))::int
```

`NULLIF` guards a day whose hourly rows all carry `total_pings = 0`, which would otherwise divide by zero and abort the rollup transaction. Existing daily rows stay wrong until backfilled: delete the matching `rollup_logs` rows and re-enqueue `hourly_to_daily` for those windows. Hourly data survives 90 days, so the backfill is bounded.

### Daily percentiles

Not fixed. The columns get a comment naming the approximation, and the chart labels its source tier, which it already knows via `source_tier`. A `ponytail:` comment records t-digest as the upgrade path.

### Partition maintenance

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('uptimekit-partitions', '0 3 * * *', $$
  SELECT create_daily_partition((CURRENT_DATE + i)::date) FROM generate_series(0, 14) i;
  SELECT drop_expired_partitions(7);
$$);
```

Idempotent, since `create_daily_partition` is `CREATE TABLE IF NOT EXISTS`. Self-healing: a rolling 14-day lead means a fortnight of downtime still recovers without manual work. This also gives `drop_expired_partitions` its first caller.

### Per-monitor timeout

`ALTER TABLE monitors ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 1000 AND 30000)` — bounds mirror `createMonitorSchema`, the way `check_interval >= 30` already does. Threaded through `monitor-scheduler.ts` -> `PingJobPayload` -> `ping-processor.ts` -> `PingClient`. `workerConfig.defaultHttpTimeoutMs` remains the fallback for a job enqueued before the deploy.

---

## Testing

| Area | Test | Kind |
| --- | --- | --- |
| Weighted average | Hours of (2 pings @ 1000ms) and (100 pings @ 100ms) yield ~118ms, not 550ms | Unit, arithmetic |
| Window snapping | 02:00-06:00 against the daily tier returns the 00:00 bucket, not empty | Integration, needs Postgres |
| Token generation | 43 chars, URL-safe alphabet, 1000 tokens distinct | Integration |
| Definer function scope | Valid token returns rows; revoked, unknown, and deleted-monitor tokens each return zero | Integration — the security test that matters |
| URL redaction | `get_shared_view` result columns never include `url` | Integration |
| Per-monitor timeout | `timeout_ms = 1000` against a 2s endpoint records `down` with a timeout message | Worker test |
| Purge revokes views | Soft-delete, drain, `revoked_at` is set | Integration |

`tests/integration/helpers/db-setup.ts` already provides `getTestClient()` and `applySchema()` but has no consumers — the tests above are its first. They skip when `DATABASE_TEST_URL` is unset rather than failing the suite for anyone without a database.

---

## Sequencing

1. **Stop the bleeding** — partition maintenance, weighted average + backfill. No user-visible change; prevents an outage.
2. **Schema & plumbing** — timeout column, the `select_ping_tier_for_team` split (pure refactor), `saved_views` columns.
3. **The feature** — `get_shared_view`, `/share/[token]`, save and manage UI, purge revocation, tier labelling.

## Risks

`get_shared_view` is the first `SECURITY DEFINER` function in this codebase that accepts attacker-controlled input. `current_team_id()` and `enqueue_monitor_purge()` are also definer, but neither takes a parameter. That function is the security boundary of the entire feature; its four-case test is non-negotiable.

Enabling `pg_cron` requires a Supabase project where the extension is available. If it is not, the fallback is an external scheduler calling `create_daily_partition` over the same connection the worker already holds — but the worker is not guaranteed to be running, which is why the database-side job is preferred.
