-- Reverse Migration: 012_drop_rls_views
DROP POLICY IF EXISTS tenant_isolation_views ON saved_views;
ALTER TABLE saved_views NO FORCE ROW LEVEL SECURITY;
ALTER TABLE saved_views DISABLE ROW LEVEL SECURITY;
