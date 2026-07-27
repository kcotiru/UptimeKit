-- Migration: 010_enable_rls_monitors
ALTER TABLE monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_monitors ON monitors;
CREATE POLICY tenant_isolation_monitors ON monitors
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);
