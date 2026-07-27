-- Migration: 008_create_rollup_log
CREATE TABLE IF NOT EXISTS rollup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rollup_type VARCHAR(50) NOT NULL CHECK (rollup_type IN ('raw_to_hourly', 'hourly_to_daily')),
  time_window TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT unique_rollup_type_window UNIQUE (rollup_type, time_window)
);

CREATE INDEX IF NOT EXISTS idx_rollup_log_type_status ON rollup_logs(rollup_type, status);
