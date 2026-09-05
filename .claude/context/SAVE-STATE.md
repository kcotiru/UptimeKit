# SAVE STATE — UptimeKit

<!-- pcm-save-state v1 | 2026-08-31 -->

**Objective:** Publicly shareable saved graph views (one monitor, a pinned absolute window, an unguessable token, no login) plus five correctness/ops gaps from the original concept. Schema is live in production; done = worker and web deployed against it.

**Stack:** Supabase Postgres 17 + pg_cron, Node 22, TypeScript (root is CommonJS/NodeNext), BullMQ + ioredis + `pg`, Next.js 14 App Router, Vitest. Root and `src/web` are **separate npm projects with separate test commands**.

## Decisions
- **Share links are public** — anon + token; the token is the entire authorization.
- **Anonymous viewers never see `monitors.url`** — redaction enforced by the SQL return shape, not by React.
- **Windows are absolute**, never relative; a sliding postmortem link is worthless.
- **One query body, two callers:** `select_ping_tier_for_team(team,…)` is INVOKER; `select_ping_tier` and `get_shared_view` both delegate. Rejected a service-role read in the Next route — it puts an RLS-bypassing client on an unauthenticated path.
- **A valid share over an empty window renders** (previously 404). Accepts a token-*validity* oracle, safe because tokens are 256-bit and an attacker cannot produce a candidate. Unknown / revoked / deleted-monitor / malformed-window / cross-tenant still return **zero rows** — that property is load-bearing.
- **Daily percentiles are exact**, read from `ping_logs_raw` only when its row count equals the hourly `total_pings`. The old "raw is gone by day 7" justification was false: the purge is `NOW() - 7d` and the daily rollup runs at D+1. `percentile_source` records the method; `ON CONFLICT` never downgrades `raw` → `hourly_approx`.

## Preferences
- **Workflow:** brainstorm → spec → plan → subagent execution with a review gate after every task. User picks from menus — don't assume the choice.
- **Tests:** a test that cannot fail on the regression it names gets replaced. Prove discrimination by reverting the fix and watching it go red.
- **Reviews:** adversarial and live — reviewers rerun real exploits rather than reading diffs.

## Done
- **Schema deployed to Supabase `hhzjeqetgjdiqgqqcpzm`.** `uptimekit-partitions` registered, active, `0 3 * * *`, on the database pg_cron polls.
- Share path **smoke-tested against production** — populated window, empty window, unknown token — then the test rows removed.
- `origin/main` contains everything through `e6f17bc` (user merged the PR).

## Next Steps
1. **Check the first-ever cron run** — done when `cron.job_run_details` shows a succeeded row for `uptimekit-partitions`. A failure here is silent and surfaces nowhere else.
2. **Get `f351354` onto main** — the search_path fix; currently the only local commit, unpushed.
3. **Deploy worker and web** — the schema already leads them, so the share feature, per-monitor timeout and exact percentiles stay dormant until they ship.

## Gotchas
- **`DATABASE_URL` is production.** Tests use `DATABASE_TEST_URL` (`uptimekit_sdd_test` on 127.0.0.1) and nothing else.
- DB-backed tests `describe.skip` silently without `DATABASE_TEST_URL` — a "green" run may have skipped them entirely.
- The local harness once masked a deployment blocker by installing pgcrypto into `public`; Supabase uses `extensions`. Keep `bootstrap-local.sql` faithful or bugs hide.
- Worker has been down since 2026-08-21; one pending row in `deletion_queue` will process on restart.
- Cron drops 14 expired partitions at 03:00 UTC Sep 1, taking ~24 never-rolled-up raw pings with them. **User reviewed and accepted this.**
- `create_daily_partition` re-runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on partitions that already have it, taking an ACCESS EXCLUSIVE lock nightly — brief, but it now happens while the worker may be writing.
- `.gitignore` has a bare `specs`, so `docs/superpowers/specs/*` is untracked.

## Key Files
- `supabase/schema.sql` — the only migration mechanism, hand-applied, must stay idempotent. The pg_cron region is fenced by `@local-test:strip-*` sentinels and must remain last in the file.
- `src/worker/processors/rollup-processor.ts` — completeness guard and the no-downgrade `CASE`.
- `src/web/lib/server/data/saved-views.ts` — share data layer; zero rows means denied, empty `points` means valid-but-empty.
