-- Down Migration: 014_drop_monitor_name_method
ALTER TABLE monitors
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS http_method;
