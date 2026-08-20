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
});
