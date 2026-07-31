-- Down Migration: 015_drop_incidents
DROP POLICY IF EXISTS tenant_isolation_incidents ON incidents;
ALTER TABLE incidents DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_incidents_team_active;
DROP INDEX IF EXISTS idx_incidents_monitor_active;
DROP TABLE IF EXISTS incidents;
