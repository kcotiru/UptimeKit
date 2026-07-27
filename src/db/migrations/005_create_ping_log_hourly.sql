-- Migration: 005_create_ping_log_hourly
CREATE TABLE IF NOT EXISTS ping_logs_hourly (
  monitor_id UUID NOT NULL,
  hour_timestamp TIMESTAMPTZ NOT NULL,
  team_id UUID NOT NULL,
  avg_time_ms NUMERIC(10, 2) NOT NULL,
  min_time_ms INTEGER NOT NULL,
  max_time_ms INTEGER NOT NULL,
  p50_time_ms INTEGER NOT NULL,
  p95_time_ms INTEGER NOT NULL,
  p99_time_ms INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  uptime_percent NUMERIC(5, 2) NOT NULL,
  PRIMARY KEY (monitor_id, hour_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_ping_hourly_team_time ON ping_logs_hourly (team_id, hour_timestamp);
