-- Migration: 013_enable_rls_users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);
