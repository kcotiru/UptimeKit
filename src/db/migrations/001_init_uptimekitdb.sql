-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- 1. Relational Tables (Multi-Tenant Setup)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS monitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'HTTP',
    interval_sec INTEGER NOT NULL DEFAULT 60,
    expected_status_code INTEGER DEFAULT 200,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitors_team_id ON monitors(team_id);

CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    cause TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'ONGOING'
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor_id ON incidents(monitor_id);

CREATE TABLE IF NOT EXISTS alert_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_channels_team_id ON alert_channels(team_id);

-- 2. Time-Series Storage (Hypertable)
CREATE TABLE IF NOT EXISTS ping_logs (
    time TIMESTAMPTZ NOT NULL,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    response_ms INTEGER,
    status_code INTEGER,
    is_up BOOLEAN NOT NULL
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
    AVG(response_ms)::INTEGER AS avg_response_ms,
    MIN(response_ms) AS min_response_ms,
    MAX(response_ms) AS max_response_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY response_ms) AS p95_response_ms
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

