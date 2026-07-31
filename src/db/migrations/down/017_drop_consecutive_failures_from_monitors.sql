-- Down Migration: 017_drop_consecutive_failures_from_monitors
ALTER TABLE monitors DROP COLUMN IF EXISTS consecutive_failures;
