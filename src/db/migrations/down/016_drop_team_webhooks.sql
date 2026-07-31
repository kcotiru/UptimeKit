-- Down Migration: 016_drop_team_webhooks
DROP POLICY IF EXISTS tenant_isolation_team_webhooks ON team_webhooks;
ALTER TABLE team_webhooks DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_team_webhooks_team_active;
DROP TABLE IF EXISTS team_webhooks;
