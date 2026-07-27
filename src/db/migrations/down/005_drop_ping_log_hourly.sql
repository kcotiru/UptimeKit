-- Reverse Migration: 005_drop_ping_log_hourly
DROP TABLE IF EXISTS ping_logs_hourly CASCADE;
