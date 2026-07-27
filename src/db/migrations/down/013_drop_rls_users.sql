-- Reverse Migration: 013_drop_rls_users
DROP POLICY IF EXISTS tenant_isolation_users ON users;
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
