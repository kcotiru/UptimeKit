import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Partitioning Integration / Validation Tests', () => {
  it('validates 004_create_ping_log_raw.sql partitioned table structure', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('PARTITION BY RANGE (timestamp)');
    expect(sql).toContain('PRIMARY KEY (monitor_id, timestamp)');
  });

  it('validates partition-manager.sql helper functions exist', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('create_daily_partition');
    expect(sql).toContain('drop_expired_partitions');
    expect(sql).toContain('list_active_partitions');
  });

  it('schedules recurring partition maintenance instead of relying on a one-off DO block', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pg_cron");
    expect(sql).toContain("uptimekit-partitions");
    // The job must both create ahead and drop behind — creating alone leaks disk.
    expect(sql).toContain('drop_expired_partitions(7)');
    // Unscheduling first is what makes re-running schema.sql idempotent.
    expect(sql).toContain("cron.unschedule('uptimekit-partitions')");
  });
});
