-- Migration: 011_enable_rls_pinglog
ALTER TABLE ping_logs_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_raw FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_raw ON ping_logs_raw;
CREATE POLICY tenant_isolation_raw ON ping_logs_raw
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);

ALTER TABLE ping_logs_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_hourly FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_hourly ON ping_logs_hourly;
CREATE POLICY tenant_isolation_hourly ON ping_logs_hourly
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);

ALTER TABLE ping_logs_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_daily FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_daily ON ping_logs_daily;
CREATE POLICY tenant_isolation_daily ON ping_logs_daily
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);
