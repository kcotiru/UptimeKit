-- Migration: 017_add_consecutive_failures_to_monitors
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
