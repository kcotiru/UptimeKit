-- Reverses 20261022183938_role_aware_rls.sql.
--
-- This restores the permissive Supabase default ON PURPOSE. The state it puts
-- back is the one the live project is in today: `anon` and `authenticated`
-- holding all eight table privileges on everything in `public`, with a single
-- FOR ALL tenant-isolation policy per table and no role test anywhere. That
-- state contains the privilege escalation the forward migration closes.
--
-- A down migration that left a tighter state than it found would not be a
-- reversal, and the forward file could then never be proven to be the thing
-- doing the work. If this file is run against production, the escalation is
-- open again until the forward migration is re-applied.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- REVOKE ALL first, so the column-level INSERT and UPDATE grants on saved_views
-- and team_invites are cleared rather than left behind underneath a table-wide
-- grant that masks them. That ordering is what reverses them: the GRANT below
-- restores plain table-wide INSERT and UPDATE on every table, which is the state
-- in which a client may name share_token or token on a write again.
--
-- MAINTAIN is in the GRANT list because it is in the state this file claims to
-- restore: pg_default_acl on the live project grants anon and authenticated
-- `arwdDxtm`, and PostgreSQL 17's trailing `m` is MAINTAIN. Without it, the
-- REVOKE ALL above would leave `arwdDxtm` minus `m`, which is tighter than what
-- was found, and a reversal that tightens is not a reversal (see the header).
-- It also means a down-then-up rehearsal can show the MAINTAIN revoke in
-- 20261022193309_partition_grant_defaults.sql actually doing work.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies, verbatim from schema.sql:709-744 and :775-778
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS monitors_select ON monitors;
DROP POLICY IF EXISTS monitors_insert ON monitors;
DROP POLICY IF EXISTS monitors_update ON monitors;
DROP POLICY IF EXISTS monitors_delete ON monitors;
DROP POLICY IF EXISTS saved_views_select ON saved_views;
DROP POLICY IF EXISTS saved_views_insert ON saved_views;
DROP POLICY IF EXISTS saved_views_update ON saved_views;
DROP POLICY IF EXISTS saved_views_delete ON saved_views;
DROP POLICY IF EXISTS team_webhooks_select ON team_webhooks;
DROP POLICY IF EXISTS team_webhooks_insert ON team_webhooks;
DROP POLICY IF EXISTS team_webhooks_update ON team_webhooks;
DROP POLICY IF EXISTS team_webhooks_delete ON team_webhooks;
DROP POLICY IF EXISTS team_invites_select ON team_invites;
DROP POLICY IF EXISTS team_invites_insert ON team_invites;
DROP POLICY IF EXISTS team_invites_update ON team_invites;
DROP POLICY IF EXISTS team_invites_delete ON team_invites;
DROP POLICY IF EXISTS incidents_select ON incidents;
DROP POLICY IF EXISTS ping_logs_raw_select ON ping_logs_raw;
DROP POLICY IF EXISTS ping_logs_hourly_select ON ping_logs_hourly;
DROP POLICY IF EXISTS ping_logs_daily_select ON ping_logs_daily;
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS teams_select ON teams;

DROP POLICY IF EXISTS tenant_isolation_teams ON teams;
CREATE POLICY tenant_isolation_teams ON teams
  FOR ALL TO authenticated USING (id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_monitors ON monitors;
CREATE POLICY tenant_isolation_monitors ON monitors
  FOR ALL TO authenticated
  USING (team_id = current_team_id())
  WITH CHECK (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_incidents ON incidents;
CREATE POLICY tenant_isolation_incidents ON incidents
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_team_webhooks ON team_webhooks;
CREATE POLICY tenant_isolation_team_webhooks ON team_webhooks
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_raw ON ping_logs_raw;
CREATE POLICY tenant_isolation_raw ON ping_logs_raw
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_hourly ON ping_logs_hourly;
CREATE POLICY tenant_isolation_hourly ON ping_logs_hourly
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_daily ON ping_logs_daily;
CREATE POLICY tenant_isolation_daily ON ping_logs_daily
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_views ON saved_views;
CREATE POLICY tenant_isolation_views ON saved_views
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_invites ON team_invites;
CREATE POLICY tenant_isolation_invites ON team_invites
  FOR ALL TO authenticated
  USING (team_id = current_team_id())
  WITH CHECK (team_id = current_team_id());

-- ---------------------------------------------------------------------------
-- The function
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS current_user_role();
