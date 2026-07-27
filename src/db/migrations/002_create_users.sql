-- Migration: 002_create_users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);
