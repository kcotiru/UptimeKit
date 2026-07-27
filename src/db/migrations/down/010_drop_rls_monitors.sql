-- Reverse Migration: 010_drop_rls_monitors
DROP POLICY IF EXISTS tenant_isolation_monitors ON monitors;
ALTER TABLE monitors NO FORCE ROW LEVEL SECURITY;
ALTER TABLE monitors DISABLE ROW LEVEL SECURITY;
