-- Migration: 007_create_saved_views
CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  creator_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  configuration JSONB NOT NULL,
  share_token VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_team_id ON saved_views(team_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_share_token ON saved_views(share_token);
