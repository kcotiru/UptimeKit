import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Monitors Integration / Validation Tests', () => {
  it('validates 003_create_monitors.sql schema constraints', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/003_create_monitors.sql'), 'utf8');
    expect(sql).toContain('check_interval >= 30');
    expect(sql).toContain("status IN ('up', 'down', 'degraded', 'paused')");
    expect(sql).toContain('is_deleted');
    expect(sql).toContain('idx_monitor_team_active');
  });

  it('validates deletion queue schema', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/009_create_deletion_queue.sql'), 'utf8');
    expect(sql).toContain('deletion_queue');
    expect(sql).toContain("status IN ('pending', 'in_progress', 'completed')");
  });
});
