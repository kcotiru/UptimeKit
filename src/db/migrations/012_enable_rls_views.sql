-- Migration: 012_enable_rls_views
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_views ON saved_views;
CREATE POLICY tenant_isolation_views ON saved_views
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);
