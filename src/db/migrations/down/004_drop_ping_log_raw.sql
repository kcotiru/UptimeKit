-- Reverse Migration: 004_drop_ping_log_raw
DROP TABLE IF EXISTS ping_logs_raw CASCADE;
