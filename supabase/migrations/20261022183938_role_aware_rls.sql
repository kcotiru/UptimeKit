-- Role-aware row level security.
--
-- Closes a privilege escalation that is live today. Three things combined to
-- make the three team roles (admin, member, viewer) decorative:
--   1. `authenticated` holds SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--      REFERENCES and TRIGGER on every table in `public`. Those are Supabase's
--      provisioning defaults and schema.sql never revoked them.
--   2. The only policy on `users` was `tenant_isolation_users`, FOR ALL with a
--      USING clause and no WITH CHECK. Postgres reuses USING as the write check
--      when WITH CHECK is absent.
--   3. No policy expression anywhere mentioned `role`.
-- So `UPDATE users SET role = 'admin' WHERE id = auth.uid()` satisfied the
-- policy, and a viewer could send it straight to PostgREST with the public anon
-- key and their own session token. The application never saw the request.
--
-- Two layers, because either alone is insufficient. The table grants are the
-- floor: a command with no grant cannot reach a policy at all. The per-command
-- policies are the role boundary on what is left.
--
-- Cross-tenant isolation was never broken and is preserved verbatim: every
-- policy below still keys on current_team_id().

-- ---------------------------------------------------------------------------
-- The caller's role
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER for the same reason as current_team_id(): a policy on
-- `users` must not recurse into itself. pg_temp is pinned explicitly because it
-- is searched before anything else named here even when omitted, so without it
-- any role could shadow `users` with a pg_temp.users carrying an
-- attacker-chosen role, and every policy below would read that instead.
--
-- Returns NULL for a session with no row in `users`. Every policy test below is
-- written so NULL denies.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role::TEXT FROM users WHERE id = auth.uid()
$$;

-- Functions are executable by PUBLIC by default, and PostgREST exposes every
-- public function as an RPC endpoint. Narrow that deliberately, the same shape
-- get_shared_view() uses in schema.sql.
REVOKE ALL ON FUNCTION current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated;

-- ---------------------------------------------------------------------------
-- The grant floor
--
-- Reads stay. Writes go, then come back only where the web app actually
-- performs one.
-- ---------------------------------------------------------------------------

-- SELECT on the three ping_logs tiers is deliberately NOT revoked. The web app
-- reads them directly as the signed-in user, and select_ping_tier_for_team() is
-- SECURITY INVOKER on purpose so that RLS performs the tenancy check
-- (schema.sql:388-394). Revoking SELECT here would blank every chart.
--
-- ping_logs_raw is partitioned. Revoking on the parent governs every access
-- that goes through the parent, which is all the app ever does; a partition
-- reached by name has RLS enabled and no policy of its own, so it denies.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ping_logs_raw FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ping_logs_hourly FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ping_logs_daily FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON incidents FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON monitors FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON saved_views FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON team_webhooks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON team_invites FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON teams FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON users FROM anon, authenticated;

-- Exactly the writes the app performs, and nothing else. The policies below
-- then decide which role and which rows. The asymmetry is deliberate: `anon`
-- gets no write grant back anywhere.
--
-- `teams` and `users` get none either. Nothing in the web app writes to either
-- one: the only code path that does is handle_new_user(), a SECURITY DEFINER
-- trigger that bypasses both grants and RLS. That is what makes the escalation
-- unreachable rather than merely policy-checked.
GRANT INSERT, UPDATE, DELETE ON monitors TO authenticated;
GRANT INSERT, UPDATE, DELETE ON team_webhooks TO authenticated;

-- saved_views.share_token and team_invites.token are the two columns whose value
-- IS the credential, so both tables get their INSERT and UPDATE grants column by
-- column with that one column left out. Everything else about the row stays
-- writable; only the secret is out of the client's reach, in both directions.
--
-- `id`, `created_at` and `updated_at` are in the INSERT lists on purpose, so a
-- client may choose a row id or backdate a row. Both are harmless here: WITH
-- CHECK pins the tenant, and a chosen id either collides with the primary key or
-- names a row the caller could have created anyway. Leaving them out would also
-- break nothing today, but it would mean a client that names its own id gets a
-- privilege error rather than a key violation, which is the less obvious
-- failure. Revisit if either column ever carries meaning beyond bookkeeping.
--
-- Why both directions matter. A client that can WRITE the column on insert
-- chooses the secret: a saved view inserted with share_token = 'abc' turns a
-- 256-bit unguessable public link into a guessable one, and a team_invites row
-- inserted with a chosen token hands a join-at-this-role capability to anyone
-- who guesses it, which is the same escalation this migration exists to close.
-- Neither is hypothetical from the client's side: PostgREST will send any column
-- the caller names. The app never names either one (createSavedView and
-- createInvite both omit it deliberately), so the database default fires and
-- gen_share_token() produces the value, which is the only thing that should.
--
-- These column lists are NOT a table-wide GRANT followed by
-- REVOKE INSERT/UPDATE (<token column>): Postgres does not subtract a column
-- privilege from a table-wide grant, so that pair is a silent no-op and the
-- column stays writable. Enumerating the grantable columns is the only form the
-- server honours.
--
-- UPDATE is narrower than INSERT on purpose: the only update the app ever makes to
-- either table is setting revoked_at (revokeSavedView, revokeInvite). Granting the
-- other columns would let a client reassign creator_id, rewrite a view's name or
-- configuration, or change a minted invite's role or expires_at after the fact.
-- The worker's purge also sets revoked_at, but over the direct Postgres URL as the
-- table owner, which no grant here governs.
--
-- Revocation is one-way: the UPDATE policies below put `revoked_at IS NOT NULL` in
-- WITH CHECK, which tests the NEW row, so a client cannot clear revoked_at to
-- resurrect a share link or invite that was deliberately killed.
--
-- ponytail: a column added to either table later is not writable by the app
-- until it is added to these lists. The upgrade path is a trigger that rejects a
-- change to the token column; it costs more than these four lines.
GRANT DELETE ON saved_views TO authenticated;
GRANT INSERT (id, team_id, creator_id, monitor_id, name, configuration, revoked_at, created_at, updated_at)
  ON saved_views TO authenticated;
GRANT UPDATE (revoked_at) ON saved_views TO authenticated;

GRANT DELETE ON team_invites TO authenticated;
GRANT INSERT (id, team_id, creator_id, role, expires_at, revoked_at, created_at)
  ON team_invites TO authenticated;
GRANT UPDATE (revoked_at) ON team_invites TO authenticated;

-- Worker-internal bookkeeping. The web app never touches either table, and both
-- already have RLS on with no policy, so this closes the grant as well.
REVOKE ALL ON rollup_logs FROM anon, authenticated;
REVOKE ALL ON deletion_queue FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-command, role-aware policies
--
-- One policy per command instead of one FOR ALL policy per table. Every INSERT
-- and UPDATE policy carries an explicit WITH CHECK: without one Postgres reuses
-- USING as the write test, which is exactly how the old `users` policy permitted
-- self-promotion.
--
-- The role test is written `current_user_role() IN ('admin','member')`, never
-- `current_user_role() <> 'viewer'`. For a session whose `users` row is missing
-- the function returns NULL and both expressions evaluate to NULL, which denies,
-- but only the first one reads that way. getSessionUser() in the web app falls
-- back to role 'viewer' for a missing profile, so the case is real.
--
-- An UPDATE needs a SELECT policy to find its rows. Every table here has one.
-- ---------------------------------------------------------------------------

-- monitors: read for the whole team, write for admin and member.
DROP POLICY IF EXISTS tenant_isolation_monitors ON monitors;

DROP POLICY IF EXISTS monitors_select ON monitors;
CREATE POLICY monitors_select ON monitors
  FOR SELECT TO authenticated
  USING (team_id = current_team_id());

DROP POLICY IF EXISTS monitors_insert ON monitors;
CREATE POLICY monitors_insert ON monitors
  FOR INSERT TO authenticated
  WITH CHECK (team_id = current_team_id() AND current_user_role() IN ('admin', 'member'));

DROP POLICY IF EXISTS monitors_update ON monitors;
CREATE POLICY monitors_update ON monitors
  FOR UPDATE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() IN ('admin', 'member'))
  WITH CHECK (team_id = current_team_id() AND current_user_role() IN ('admin', 'member'));

DROP POLICY IF EXISTS monitors_delete ON monitors;
CREATE POLICY monitors_delete ON monitors
  FOR DELETE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() IN ('admin', 'member'));

-- saved_views: same split as monitors.
DROP POLICY IF EXISTS tenant_isolation_views ON saved_views;

DROP POLICY IF EXISTS saved_views_select ON saved_views;
CREATE POLICY saved_views_select ON saved_views
  FOR SELECT TO authenticated
  USING (team_id = current_team_id());

DROP POLICY IF EXISTS saved_views_insert ON saved_views;
CREATE POLICY saved_views_insert ON saved_views
  FOR INSERT TO authenticated
  WITH CHECK (team_id = current_team_id() AND current_user_role() IN ('admin', 'member'));

DROP POLICY IF EXISTS saved_views_update ON saved_views;
CREATE POLICY saved_views_update ON saved_views
  FOR UPDATE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() IN ('admin', 'member'))
  WITH CHECK (
    team_id = current_team_id()
    AND current_user_role() IN ('admin', 'member')
    AND revoked_at IS NOT NULL
  );

DROP POLICY IF EXISTS saved_views_delete ON saved_views;
CREATE POLICY saved_views_delete ON saved_views
  FOR DELETE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() IN ('admin', 'member'));

-- team_webhooks: admin only, reads included. Alert destinations are an admin
-- setting, and a webhook URL is itself a secret.
DROP POLICY IF EXISTS tenant_isolation_team_webhooks ON team_webhooks;

DROP POLICY IF EXISTS team_webhooks_select ON team_webhooks;
CREATE POLICY team_webhooks_select ON team_webhooks
  FOR SELECT TO authenticated
  USING (team_id = current_team_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS team_webhooks_insert ON team_webhooks;
CREATE POLICY team_webhooks_insert ON team_webhooks
  FOR INSERT TO authenticated
  WITH CHECK (team_id = current_team_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS team_webhooks_update ON team_webhooks;
CREATE POLICY team_webhooks_update ON team_webhooks
  FOR UPDATE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() = 'admin')
  WITH CHECK (team_id = current_team_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS team_webhooks_delete ON team_webhooks;
CREATE POLICY team_webhooks_delete ON team_webhooks
  FOR DELETE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() = 'admin');

-- team_invites: admin only. An invite row carries a live join token and the role
-- it grants, so read access is as sensitive as write access here.
DROP POLICY IF EXISTS tenant_isolation_invites ON team_invites;

DROP POLICY IF EXISTS team_invites_select ON team_invites;
CREATE POLICY team_invites_select ON team_invites
  FOR SELECT TO authenticated
  USING (team_id = current_team_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS team_invites_insert ON team_invites;
CREATE POLICY team_invites_insert ON team_invites
  FOR INSERT TO authenticated
  WITH CHECK (team_id = current_team_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS team_invites_update ON team_invites;
CREATE POLICY team_invites_update ON team_invites
  FOR UPDATE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() = 'admin')
  WITH CHECK (
    team_id = current_team_id()
    AND current_user_role() = 'admin'
    AND revoked_at IS NOT NULL
  );

DROP POLICY IF EXISTS team_invites_delete ON team_invites;
CREATE POLICY team_invites_delete ON team_invites
  FOR DELETE TO authenticated
  USING (team_id = current_team_id() AND current_user_role() = 'admin');

-- Read-only for every role. These tables are written by the worker over the
-- direct Postgres URL and by definer functions, neither of which consults a
-- policy. No write grant survives above either, so the absent write policy is
-- the second of two independent denials.
DROP POLICY IF EXISTS tenant_isolation_incidents ON incidents;
DROP POLICY IF EXISTS incidents_select ON incidents;
CREATE POLICY incidents_select ON incidents
  FOR SELECT TO authenticated
  USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_raw ON ping_logs_raw;
DROP POLICY IF EXISTS ping_logs_raw_select ON ping_logs_raw;
CREATE POLICY ping_logs_raw_select ON ping_logs_raw
  FOR SELECT TO authenticated
  USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_hourly ON ping_logs_hourly;
DROP POLICY IF EXISTS ping_logs_hourly_select ON ping_logs_hourly;
CREATE POLICY ping_logs_hourly_select ON ping_logs_hourly
  FOR SELECT TO authenticated
  USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_daily ON ping_logs_daily;
DROP POLICY IF EXISTS ping_logs_daily_select ON ping_logs_daily;
CREATE POLICY ping_logs_daily_select ON ping_logs_daily
  FOR SELECT TO authenticated
  USING (team_id = current_team_id());

-- users: the team roster is readable by the team, writable by nobody over the
-- API. This policy is the one the escalation went through, and it is now SELECT
-- only, so there is no write test left for Postgres to reuse USING as.
DROP POLICY IF EXISTS tenant_isolation_users ON users;
DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users
  FOR SELECT TO authenticated
  USING (team_id = current_team_id());

-- teams: own team only, read only.
DROP POLICY IF EXISTS tenant_isolation_teams ON teams;
DROP POLICY IF EXISTS teams_select ON teams;
CREATE POLICY teams_select ON teams
  FOR SELECT TO authenticated
  USING (id = current_team_id());
