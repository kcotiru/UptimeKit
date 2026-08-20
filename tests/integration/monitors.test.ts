import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Monitors Integration / Validation Tests', () => {
  it('validates 003_create_monitors.sql schema constraints', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('check_interval >= 30');
    expect(sql).toContain("status IN ('up', 'down', 'degraded', 'paused')");
    expect(sql).toContain('is_deleted');
    expect(sql).toContain('idx_monitor_team_active');
  });

  it('validates deletion queue schema', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('deletion_queue');
    // 'processing' is the value purge-processor.ts actually writes.
    expect(sql).toContain("status IN ('pending', 'processing', 'completed')");
    expect(sql).toContain('processed_at');
  });
});
