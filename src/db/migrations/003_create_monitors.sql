-- Migration: 003_create_monitors
CREATE TABLE IF NOT EXISTS monitors (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  url TEXT NOT NULL,
  expected_status INTEGER NOT NULL DEFAULT 200,
  check_interval INTEGER NOT NULL CHECK (check_interval >= 30),
  status VARCHAR(50) NOT NULL DEFAULT 'paused' CHECK (status IN ('up', 'down', 'degraded', 'paused')),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_team_active ON monitors(team_id, is_deleted);
