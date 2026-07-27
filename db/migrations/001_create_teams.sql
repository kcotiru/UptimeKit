-- Migration: 001_create_teams
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL,
  quota_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
