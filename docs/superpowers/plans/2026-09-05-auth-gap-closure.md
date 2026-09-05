# Auth gap closure

Close the four gaps in the login stack: no password reset, no email verification,
no effective rate limiting, no way to join an existing team.

## Decisions (user-confirmed 2026-09-05)

| Gap | Choice |
|---|---|
| Email delivery | Supabase built-in sender. Portfolio project; custom SMTP is a dashboard toggle later, **zero code change**. Mark the ceiling with a `ponytail:` comment. |
| Rate limiting | Move sign-in to the browser client. Supabase's per-IP throttle applies again. **Net deletion** — the proxy route disappears. |
| Email verification | `supabase.auth.signUp()` + an `AFTER INSERT` trigger on `auth.users` that creates team + profile. Deletes `supabaseAdmin()` and the service-role key from the request path. |
| Invites | Unguessable invite link, mirroring the existing `share_token` pattern. No email dependency. |

## Ladder notes

- `gen_share_token()` already exists (`schema.sql:259`) — reuse as the invite token DEFAULT. Do not write a second generator.
- `saved-view-list.tsx` is already a create/revoke/copy-link list. The invite UI copies its shape; do not invent a new interaction.
- `users.role` already exists with `CHECK (role IN ('admin','member','viewer'))`. No schema change for roles.
- Supabase sends and verifies both the confirmation and the recovery mail. Write no token table, no expiry logic, no mailer for these.
- Rate limiting is not built. It falls out of Task 2 for free.

## Trust boundary — read before touching the trigger

`raw_user_meta_data` is **client-supplied**: anything passed to `signUp({ options: { data } })`
lands there unvalidated. The trigger may read `team_name` (harmless — it names the
caller's own team) and `invite_token` (harmless — it must match a live invite row).
It must **never** read a `team_id` or `role` from metadata; role comes from the
invite row only. A client that could set its own role would own every team.

---

## Task 0 — Make the test harness able to see this work

`DATABASE_TEST_URL` is empty in root `.env`, so every DB-backed test
`describe.skip`s silently. `uptimekit_sdd_test` already exists on 127.0.0.1.

1. Set `DATABASE_TEST_URL=postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test` in root `.env`.
2. `tests/integration/helpers/bootstrap-local.sql:20` stubs `auth.users` as `(id UUID PRIMARY KEY)`.
   Add `email TEXT` and `raw_user_meta_data JSONB DEFAULT '{}'::jsonb` — the trigger reads both.
   This makes the stub *more* faithful to real Supabase, not less.

**Verify:** `npm run test:integration` runs the DB suites instead of skipping them.

---

## Task 1 — Schema: invites table + signup trigger

**File:** `supabase/schema.sql`. Idempotent, as always. Insert **before** the
`@local-test:strip-start (pg_cron)` fence — that block must stay last in the file.

1. `team_invites`: `id`, `team_id -> teams`, `creator_id -> users`, `token VARCHAR(255) NOT NULL UNIQUE DEFAULT gen_share_token()`,
   `role` with the same CHECK as `users.role` defaulting to `'member'`, `expires_at TIMESTAMPTZ NOT NULL`,
   `revoked_at TIMESTAMPTZ`, `created_at`. Index on `token`. RLS on, `tenant_isolation_invites`
   `FOR ALL TO authenticated USING/WITH CHECK (team_id = current_team_id())`.
2. `handle_new_user()` — `SECURITY DEFINER`, `SET search_path = public, pg_temp` (repo convention, see `f351354`):
   - invite token present -> resolve `team_id` + `role` from a live invite (`revoked_at IS NULL AND expires_at > NOW()`); no match -> `RAISE EXCEPTION`.
   - otherwise -> `INSERT INTO teams` (name from metadata, falling back to a name derived from the email local part), role `'admin'`.
   - then `INSERT INTO users (id, team_id, email, role)`.
   Raising rolls back the `auth.users` insert, so a failed signup strands nothing —
   this is what replaces the manual rollback in the deleted register route.
3. `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;` then create it `AFTER INSERT ... FOR EACH ROW`.
4. `describe_invite(p_token TEXT)` — `SECURITY DEFINER`, `STABLE`, pinned search_path,
   returns `(team_name TEXT, role TEXT)`. Live invite -> one row; unknown, revoked or
   expired -> **zero rows**. Anonymous visitors call it to see whose team they are joining.
   Same accepted token-validity oracle as `get_shared_view`; comment it the same way.

**Tests** — new `tests/integration/auth-signup.test.ts`:
- plain signup creates exactly one team + one `users` row at role `admin`
- signup with a live invite joins the **existing** team at the invite's role, creating **no** new team
- signup with an unknown / revoked / expired token raises, and leaves **no** `auth.users`, `teams` or `users` row
- metadata carrying `role: 'admin'` or a foreign `team_id` alongside a `member` invite is **ignored** — the row lands at `member` on the invited team
- `describe_invite` returns zero rows for unknown, revoked and expired tokens

Prove the last two discriminate: they are the ones guarding the trust boundary.

---

## Task 2 — Move auth to the browser, delete the proxy routes

1. New `lib/client/supabase.ts` — `createBrowserClient` from `@supabase/ssr` (already a dependency).
2. New `lib/shared/validations/redirect.ts` — lift the same-origin guard currently
   inline at `login-form.tsx:14-18`. Task 3's callback route needs the same check;
   one function, both callers. Unit test it: `/dashboard`, `//evil.com`, `https://evil.com`, `null`, empty string.
3. `login-form.tsx` -> `supabase.auth.signInWithPassword` directly.
4. `register-form.tsx` -> `supabase.auth.signUp` with `options.data.team_name`.
5. `sidebar.tsx:36` -> `supabase.auth.signOut()` instead of `fetch('/api/auth/logout')`.
6. **Delete** `app/api/auth/{login,register,logout}/route.ts`, then the now-empty `app/api` tree.
7. **Delete** `supabaseAdmin()` from `lib/server/supabase.ts`. Grep first to confirm the
   register route was its only caller. `SUPABASE_SERVICE_ROLE_KEY` leaves `.env.local.example` too.
8. Update the `matcher` comment in `middleware.ts` — its "the only routes left under
   app/api are the auth ones" note is about to be false.

**Verify:** `npx tsc --noEmit`, `npm run lint`, and a real browser round trip —
sign in, hit `/dashboard/monitors`, sign out, confirm the redirect back to `/login`.

---

## Task 3 — Email verification and password reset

1. `app/auth/callback/route.ts` — `exchangeCodeForSession(code)`, then redirect to the
   `next` param **through the Task 2 validator**. Handles both the confirmation and the
   recovery link. Keep it out of the middleware matcher; it must run without a session.
2. `register-form.tsx` — pass `emailRedirectTo` pointing at `/auth/callback?next=/dashboard/monitors`.
   On success show a "check your email" state instead of pushing to the dashboard;
   Supabase now returns a user with no session until the address is confirmed.
3. `app/(auth)/forgot-password/page.tsx` + form — `resetPasswordForEmail` with `redirectTo`
   pointing at `/auth/callback?next=/reset-password`.
   Always render the same "if that address exists, a link is on its way" — do not leak which emails are registered.
4. `app/(auth)/reset-password/page.tsx` + form — `updateUser({ password })` against the recovery session.
5. Link "Forgot password?" from the login form.
6. Add `/forgot-password` and `/reset-password` to the middleware `matcher`. `/reset-password`
   needs a session (the recovery one), so it must **not** join the login/register
   "already signed in, go to dashboard" branch — check that rule explicitly.
7. `ponytail:` comment naming the built-in-sender ceiling and custom SMTP as the upgrade path.

Match the existing form markup exactly — same card, same input classes, same error block.

---

## Task 4 — Invite UI

1. `lib/server/data/invites.ts` + `lib/server/actions/invites.ts` — list, create (role +
   expiry), revoke. Follow `saved-views.ts` shape; RLS scopes every query, so no manual `team_id` filter.
2. `components/settings/invite-list.tsx` — modelled on `saved-view-list.tsx`: create with a
   role select, copy link, revoke. Render the link as `/register?invite=<token>` on the current origin.
3. Mount it in `app/dashboard/settings/page.tsx` beside the shared-views section.
4. `register/page.tsx` + form — when `?invite=` is present, call `describe_invite` to show
   "You're joining **Acme** as a member", hide the team-name field, and pass
   `invite_token` in the signUp metadata. Invalid token -> say so plainly and offer normal signup.
5. Only `admin` should create invites. RLS gives team isolation but not role gating;
   check the role in the server action and say so in a comment.

**Test:** the register form's invite/no-invite branching, and that the action refuses a non-admin.

---

## Task 5 — Docs and final verification

1. README: the new signup flow, the trigger's role in it, and the fact that
   "Confirm email" must be ON in Supabase Auth settings for verification to mean anything.
2. Note the schema-first rule again: **apply `schema.sql` before deploying this web build.**
   A web build that calls `describe_invite` against a database without it fails at signup.
3. Full suite: root `npm test`, `src/web` `npm test`, `npx tsc --noEmit`, `npm run lint`.
4. Manual: register -> confirm mail -> sign in -> invite -> second account joins -> forgot password -> reset -> sign in with the new password.

## Out of scope

MFA, OAuth providers, session-timeout config, `last_login_at` (still unwritten), and
role *enforcement* beyond invite creation — every authenticated team member keeps the
access they have today.
