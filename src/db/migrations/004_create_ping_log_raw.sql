-- Migration: 004_create_ping_log_raw
CREATE TABLE IF NOT EXISTS ping_logs_raw (
  monitor_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  team_id UUID NOT NULL,
  response_time_ms INTEGER NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  PRIMARY KEY (monitor_id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_ping_raw_team_time ON ping_logs_raw (team_id, timestamp);
