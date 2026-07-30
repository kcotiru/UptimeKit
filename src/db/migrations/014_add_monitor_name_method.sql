-- Migration: 014_add_monitor_name_method
ALTER TABLE monitors
  ADD COLUMN name VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN http_method VARCHAR(10) NOT NULL DEFAULT 'GET';
