-- Migration: 015_create_incidents
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  monitor_id UUID NOT NULL REFERENCES monitors(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  cause TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor_active ON incidents(monitor_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_incidents_team_active ON incidents(team_id, is_deleted);

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_incidents ON incidents;
CREATE POLICY tenant_isolation_incidents ON incidents
  FOR ALL
  USING (team_id = NULLIF(current_setting('app.current_team_id', true), '')::uuid);
