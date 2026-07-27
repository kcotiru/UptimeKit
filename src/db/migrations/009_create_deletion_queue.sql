-- Migration: 009_create_deletion_queue
CREATE TABLE IF NOT EXISTS deletion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES monitors(id),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  batches_processed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_queue_status ON deletion_queue(status);
