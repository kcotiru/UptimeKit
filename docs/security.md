# Security posture

What this project defends, what it knowingly does not, and why. Written against
the code as it ships, not as it was intended. Where a claim is backed by a test,
the test is named, so you can check it rather than take it on trust.

The integration tests run against a real Postgres via `DATABASE_TEST_URL`. The
worker suite went from 168 to 201 tests across 34 files and the web suite from
157 to 332 across 31 files; `tests/integration/rls-roles.test.ts` alone
contributes 33. The worker count drops to 119 when the database-backed tests
skip, so 201 is itself the evidence they ran.

UptimeKit is a Next.js 14 app on Supabase (Postgres, Auth, RLS) with a separate
worker that performs the checks. The web app is a deployed portfolio with open
self-service signup, so the threat model is an authenticated stranger, not a
trusted team.

## Cross-tenant isolation was already correct

The README says the database refuses to leak one team's monitors to another.
That was true before this hardening and is true now. Every policy is scoped to
`current_team_id()`, and `anon` can reach no table. A test asserts it after the
policy rewrite (`cross tenant isolation still holds after the rewrite`,
`tests/integration/rls-roles.test.ts`).

What was false was any implication that `viewer` and `member` were privilege
boundaries. They were labels. `authenticated` held every write privilege on
every table, and the single `FOR ALL` policy on `users` had no `WITH CHECK`, so
Postgres reused its `USING` clause as the write test. A viewer could send
`UPDATE users SET role = 'admin' WHERE id = auth.uid()` straight to PostgREST
with the public anon key and their own session token, and the app would never
see the request. The roles are now enforced where it cannot be bypassed.

## The three layers

1. **Postgres** is the boundary. Everything below it is there to turn a refusal
   into a readable sentence.
2. **Server actions** check the role before touching the database, validate
   every argument with zod, and sanitise every error.
3. **The UI** hides controls the caller could not use.

### The role matrix, as enforced in Postgres

| | viewer | member | admin |
| --- | --- | --- | --- |
| Read monitors, incidents, ping data, saved views, team roster | yes | yes | yes |
| Create, edit, delete monitors | no | yes | yes |
| Create, revoke, delete saved views | no | yes | yes |
| Read or write webhooks | no | no | yes |
| Read or write invites | no | no | yes |
| Write `users` or `teams` through the API | no | no | no |

`users` and `teams` have no write grant for anyone. The only code that writes
them is `handle_new_user()`, a `SECURITY DEFINER` trigger, which is what makes
the escalation unreachable rather than merely policy-checked.

## What is defended

**The role boundary, in Postgres.** Per-command RLS policies, each write with an
explicit `WITH CHECK`, replace one `FOR ALL` policy per table that had neither a
`WITH CHECK` nor a role predicate. Underneath them is a write-privilege floor:
`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN`
are revoked from `anon` and `authenticated`, then granted back to
`authenticated` only where the app performs a write. A command with no grant
never reaches a policy at all. Migrations:
`supabase/migrations/20261022183938_role_aware_rls.sql` and
`20261022193309_partition_grant_defaults.sql`. Tests:
`tests/integration/rls-roles.test.ts` (member and viewer on monitors and saved
views, admin-only webhooks and invites, `no role can update users.role through
the api`).

**Secrets nobody can choose.** Writes to `saved_views` and `team_invites` are
granted column by column, leaving out `saved_views.share_token` and
`team_invites.token`. A client cannot pick its own public link or join token;
the database default generates it. Tests: `a client cannot choose a saved view
share token`, `a client cannot choose a team invite token`.

**Tomorrow's partition is not writable.** `ping_logs_raw` gets a new daily
partition from a scheduled job, and a new table inherits the schema's default
privileges. Default privileges are now revoked for tables created by `postgres`,
and `create_daily_partition()` also revokes on the partition it just made.
Tests: `a partition created after the migration is not writable by
authenticated`, `the revoke inside create_daily_partition holds when the default
privileges grant writes`. See the accepted risk below for what these do not
cover.

**Function execute grants.** The `SECURITY DEFINER` functions the advisor flagged
(`enqueue_monitor_purge`, `current_team_id`, `describe_invite`) no longer carry
the `PUBLIC` grant, using the revoke-then-regrant shape `get_shared_view` already
had. `select_ping_tier` now pins `pg_temp` in its `search_path` like every other
function. Migration `20261022232225_function_grants.sql`; tests
`no function this migration settled is executable by PUBLIC` and `every function
in public pins pg_temp in its search_path`.

**Role checks in the server actions, and gating in the UI.** Of the eleven
server actions, ten check the role (`requireRole` in
`src/web/lib/server/actions/require-role.ts`; invite actions check
`user.role !== 'admin'` directly). The eleventh, `fetchMetricsAction`, requires a
session only, on purpose: viewers read metrics and RLS scopes the rows. Controls
a viewer could not use are hidden in the sidebar, monitor list, monitor row,
monitor detail view, saved-view list and settings page, and the new-monitor page
shows a sentence instead of a form. Tests: `action-guards.test.ts`,
`write-controls.test.ts`, `write-controls-components.test.ts`,
`settings-gating.test.ts`.

**Argument validation.** Every server action argument goes through zod. Ids and
metric windows use `lib/shared/validations/action-args.ts` (`uuidArg`,
`metricsWindow`); the `input` payloads of `createMonitorAction`,
`createWebhookAction`, `createSavedViewAction` and `createInviteAction` are
validated in the data layer by the per-entity schemas under
`lib/shared/validations/`. The same goes for the monitor detail page's
`searchParams`, with a 400 day cap on any requested window. Tests:
`action-validation.test.ts`, `monitor-page-window.test.ts`.

**Error sanitisation.** `toUserMessage` passes through only what this codebase
wrote for users, a `ZodError` or a `UserError`. Anything else, notably PostgREST
text naming tables and constraints, is logged server side and replaced by one
generic string. Test: `action-error.test.ts`.

**Cookies and cache headers.** Auth cookies carry `Secure` in production, and the
`Cache-Control` headers Supabase supplies are carried onto both the response and
any redirect in middleware and `/auth/callback`, so a response bearing
`Set-Cookie` is never cached there. The server client used by Server Actions
cannot copy them, because Next offers an action no way to set response headers;
those responses are POSTs, which no CDN caches by default. Test:
`cookie-options.test.ts`.

**Content Security Policy, enforcing.** The CSP ships enforcing, not
report-only, after every route except one (the emailed recovery exchange through
`/auth/callback`) was loaded in a browser with a clean console. The routes middleware matches, except `/`, get a per-request nonce with
`'strict-dynamic'` and no `'unsafe-inline'` in `script-src`. Three routes do not:
`/` (see accepted risk 6), and `/auth/callback` and `/opengraph-image`, which
take the static policy. Those last two should cost nothing: `/auth/callback` is a
redirect-only route handler that returns no HTML, and `/opengraph-image` returns
an image, so neither renders a script and a `script-src` concession has nothing
to act on. That is reasoning, not a test.
Policy source:
`src/web/lib/shared/csp.js`; wiring in `src/web/middleware.ts` and
`src/web/next.config.js`; tests in `headers.test.ts`. Also set: `frame-ancestors
'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
`nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive
`Permissions-Policy`. The one exception and the style concession are accepted
risks 11 and 7.

**SSRF.** The validator is a unicast allowlist rather than a denylist: an
address is allowed only if it is in none of ipaddr.js's special ranges
(`src/shared/security/ip-range.ts`). The webhook Test button sends
`redirect: 'manual'` and treats a 3xx as a failure, and nothing it returns to a
browser contains a resolved IP or range. Tests: `ssrf.test.ts`
(`does not follow redirects`, `treats a 3xx as a failure`, `never returns the
resolved ip or range of a refused url`).

**The framework floor.** `next` is raised to `^14.2.35`, past CVE-2025-29927
(middleware authorization bypass) and CVE-2025-67779 / CVE-2025-55184 (RSC
deserialisation denial of service). The unused `react-hook-form` dependency was
removed.

## Two findings that were invisible

**`MAINTAIN` was granted to `anon` and `authenticated`.** Supabase's default
privileges hand both roles `arwdDxtm`, and on PostgreSQL 17 the trailing `m` is
`MAINTAIN` (`VACUUM`, `ANALYZE`, `REINDEX`, `CLUSTER`, `LOCK TABLE`). It is now
revoked. It matters beyond the privilege itself: `information_schema` does not
report it, and the test harness could not see it until the harness was widened to
grant it too. A purely test-driven pass would have called the floor done while
`authenticated` still held it everywhere. Test: `authenticated holds no MAINTAIN
on the existing tables`.

**The webhook Test button was more permissive than production.** It followed
redirects through global `fetch`, while the real notification send uses undici's
`request`, which does not. Test could report success for a destination that
would fail for real. The two now agree.

## What is accepted, and why

Each of these is a decision, not an oversight. None of these is claimed as
defended above.

1. **The session cookie is not `HttpOnly`.** `@supabase/ssr` needs the browser
   client to read the refresh token, so it sets `httpOnly: false` by design.
   Supabase documents `HttpOnly` as unnecessary for that reason; OWASP recommends
   it. That disagreement cannot be settled here without breaking browser-side
   auth. This project sides with Supabase on the cookie, because the alternative
   is a different auth architecture, and treats the CSP as the compensating
   control: an XSS is the way this token is stolen, so the policy that blocks
   injected script is the one that matters. That is why it is enforcing.
2. **The cookie `maxAge` is 400 days,** Supabase's default. The refresh token's
   real lifetime is enforced server side, so shortening the cookie would sign
   people out without shortening anything that matters.
3. **There is no rate limiting.** Sign-in, sign-up and password reset go from the
   browser straight to Supabase, so Vercel's firewall never sees them. Supabase's
   own per-IP limits are the real control: `/token` 150 per 5 minutes, `/signup`
   30 per 5 minutes, and 2 emails per hour on the built-in SMTP. A Vercel WAF rule
   on `/share` is the available upgrade and is a dashboard rule, not code. (Figures are
   Supabase's published defaults, not something this repo enforces or tests.)
4. **`getClaims()` verifies the JWT locally,** so a session revoked mid-token
   lifetime stays valid until the token expires. RLS still authorises every query,
   so that window grants no data a valid token did not already reach.
5. **A role change takes effect on the next request,** not mid-render, because
   `getSessionUser` is wrapped in React `cache()` (test: `is wrapped in cache() so
   a second call does not re-invoke getClaims`).
6. **`/` carries a weaker CSP, with `'unsafe-inline'` in `script-src`.** A nonce
   CSP requires dynamic rendering and `/` is static. It is defensible on that page
   specifically: it renders no session and no user-controlled data, and middleware
   redirects signed-in visitors away from it. `/auth/callback` and
   `/opengraph-image` share that static policy. `experimental.sri` is the route to
   closing the gap and was not taken. Because of this page, the overall policy is
   not strict, and nothing here should be read as saying it is.
7. **`style-src 'unsafe-inline'` is permanent while Recharts is in use.** Recharts
   and several components emit inline styles. This is a `style-src` concession
   only and does not touch `script-src`.
8. **There is no `report-uri`,** so a production CSP violation is visible only in
   one person's browser console. A reporting endpoint is API surface this
   codebase has deliberately avoided.
9. **The webhook Test button honours no `SSRF_ALLOWLIST`,** so it refuses an
   internal host the worker would accept. Wiring it up needs a new Vercel
   environment variable kept in step with the worker's. Deliberate.
10. **`login-form.tsx` still distinguishes "email not confirmed" from bad
    credentials.** That is an account-existence oracle, but with open self-service
    signup it is already available by trying to register, so removing it would
    cost diagnosability and buy nothing.
11. **The emailed password-recovery flow through `/auth/callback` was not
    exercised under CSP enforcement.** Every other route was loaded in a browser
    with the policy enforcing and a clean console. This one needs edits to tracked
    configuration to work on a local stack, so it is unverified, not covered.
12. **The 03:00 `pg_cron` partition job is rehearsed in no environment.** The
    revoke inside `create_daily_partition` is proven by test when the function is
    called directly, but the scheduled path that creates tomorrow's partition is
    exercised nowhere. After applying the migrations, read a fresh partition's ACL
    the next morning:

    ```sql
    SELECT c.relname, c.relacl::text FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'ping_logs_raw_%'
    ORDER BY c.relname DESC LIMIT 3;
    ```

    In the `relacl` string, find the `authenticated=` entry for the newest
    partition. It should be `authenticated=r/postgres`: `r` and nothing else. (A
    bare `=r/postgres` is the PUBLIC grantee, not `authenticated`.) An
    `authenticated=` entry with any of `a`, `w`, `d`, `D`, `x`, `t` or `m` in it means the scheduled
    path is not applying the revoke.
13. **Three `SECURITY INVOKER` functions stay callable over REST by `anon`:**
    `create_daily_partition`, `drop_expired_partitions` and
    `list_active_partitions` keep their implicit `PUBLIC EXECUTE`. The first two
    fail for a non-owner (they need schema `CREATE` and ownership of
    `ping_logs_raw`); the third leaks only partition names. Migration 3's
    criterion is the definer/invoker split, so this is consistent, not missed.
14. **The form's minimum password length is 8, Supabase's is 6.**
    `lib/shared/password.ts` is stricter than the API, so a 6 or 7 character
    password is accepted by the API and refused by the form. No existing user is
    affected: sign-in runs no length check.
15. **DNS rebinding in the Test button** is a known, deliberate deferral. See
    [known-issues.md](known-issues.md#the-test-webhook-button-is-open-to-dns-rebinding).

## Out of scope

The worker's ping may follow a redirect to a bare IP literal, skipping the
resolved-IP pin. The worker was deliberately left untouched by this work, and the
item is written up, with its fix, in
[known-issues.md](known-issues.md#the-workers-ping-may-follow-a-redirect-to-a-bare-ip-literal).
It is inferred from reading the code and has not been executed.

## For the deployer

- **Enable leaked password protection** in the Supabase dashboard (Authentication,
  Password settings). No code substitutes for it.
- **Apply the migrations before deploying the app changes,** with
  `MIGRATE_CONFIRM=<project-ref> npm run migrate -- --hosted`. The confirmation
  is required even though nothing is dropped: the role-aware migration contains
  the word `TRUNCATE` (it revokes that privilege) and the runner's destructive
  guard matches on the keyword. Either order is safe on its own, since the app's
  guards only turn a privilege error into a sentence, but migrations first never
  leaves the app refusing things the database still permits.
- **Run the partition ACL check** from accepted risk 12 the morning after.
- **Verify the grant floor after applying.** The partition check above covers
  only tomorrow's partition, and `scripts/audit-schema-parity.ts` does not audit
  grants. These are read-only:

  ```sql
  -- the floor: expect authenticated=r on the ping tiers, incidents, users, teams
  SELECT relname, relacl::text FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND relkind IN ('r','p') ORDER BY relname;
  -- the credential columns: expect 9 rows for saved_views and 7 for team_invites, none naming the token column
  SELECT c.relname, a.attname, a.attacl::text FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid WHERE a.attacl IS NOT NULL ORDER BY 1,2;
  -- the functions: expect no bare "=X/" entry on current_team_id, describe_invite or enqueue_monitor_purge
  SELECT proname, proacl::text FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1;
  ```
- **Promoting a teammate now needs the SQL editor.** No role has a write grant on
  `users`, so there is no in-product way to change someone's role. Admins were
  given that capability in the spec's role matrix and the implementation
  deliberately withholds it. Run, as the project owner:
  `UPDATE users SET role = 'admin' WHERE id = '<user uuid>';` (or `'member'`,
  `'viewer'`).
