-- Reverse Migration: 006_drop_ping_log_daily
DROP TABLE IF EXISTS ping_logs_daily CASCADE;
