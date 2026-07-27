-- Reverse Migration: 011_drop_rls_pinglog
DROP POLICY IF EXISTS tenant_isolation_raw ON ping_logs_raw;
ALTER TABLE ping_logs_raw NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_raw DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_hourly ON ping_logs_hourly;
ALTER TABLE ping_logs_hourly NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_hourly DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_daily ON ping_logs_daily;
ALTER TABLE ping_logs_daily NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_daily DISABLE ROW LEVEL SECURITY;
