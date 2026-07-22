-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- 1. Relational Tables (Multi-Tenant Setup)
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    expected_status_code INTEGER DEFAULT 200,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitors_team_id ON monitors(team_id);

-- 2. Time-Series Storage (Hypertable)
CREATE TABLE IF NOT EXISTS ping_logs (
    time TIMESTAMPTZ NOT NULL,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status_code INTEGER,
    response_time_ms INTEGER,
    is_up BOOLEAN NOT NULL,
    error_message TEXT
);

-- Convert to TimescaleDB Hypertable
SELECT create_hypertable('ping_logs', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_ping_logs_monitor_time ON ping_logs (monitor_id, time DESC);

-- 3. Continuous Aggregates & Policies
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_monitor_stats
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    monitor_id,
    AVG(response_time_ms)::INTEGER AS avg_response_time,
    MIN(response_time_ms) AS min_response_time,
    MAX(response_time_ms) AS max_response_time,
    COUNT(CASE WHEN is_up THEN 1 END)::FLOAT / COUNT(*) * 100 AS uptime_percentage
FROM ping_logs
GROUP BY bucket, monitor_id;

-- Schedule continuous aggregate refresh (runs hourly)
SELECT add_continuous_aggregate_policy('hourly_monitor_stats',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE);

-- Auto-delete raw minute ping logs older than 7 days
SELECT add_retention_policy('ping_logs', INTERVAL '7 days', if_not_exists => TRUE);
