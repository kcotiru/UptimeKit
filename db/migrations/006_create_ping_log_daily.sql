-- Migration: 006_create_ping_log_daily
CREATE TABLE IF NOT EXISTS ping_logs_daily (
  monitor_id UUID NOT NULL,
  day_timestamp TIMESTAMPTZ NOT NULL,
  team_id UUID NOT NULL,
  avg_time_ms NUMERIC(10, 2) NOT NULL,
  min_time_ms INTEGER NOT NULL,
  max_time_ms INTEGER NOT NULL,
  p50_time_ms INTEGER NOT NULL,
  p95_time_ms INTEGER NOT NULL,
  p99_time_ms INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  uptime_percent NUMERIC(5, 2) NOT NULL,
  PRIMARY KEY (monitor_id, day_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_ping_daily_team_time ON ping_logs_daily (team_id, day_timestamp);
