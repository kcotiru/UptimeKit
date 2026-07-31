-- Migration: 016_create_team_webhooks
CREATE TABLE IF NOT EXISTS team_webhooks (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('slack', 'discord', 'generic')),
  url TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_webhooks_team_active ON team_webhooks(team_id, is_deleted);

ALTER TABLE team_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_webhooks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_team_webhooks ON team_webhooks;
CREATE POLICY tenant_isolation_team_webhooks ON team_webhooks
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);
