import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Rollup Schema and Logic Validation Tests', () => {
  it('validates 005_create_ping_log_hourly.sql schema', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/005_create_ping_log_hourly.sql'), 'utf8');
    expect(sql).toContain('avg_time_ms');
    expect(sql).toContain('p50_time_ms');
    expect(sql).toContain('p95_time_ms');
    expect(sql).toContain('p99_time_ms');
  });

  it('validates 006_create_ping_log_daily.sql schema', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/006_create_ping_log_daily.sql'), 'utf8');
    expect(sql).toContain('day_timestamp');
    expect(sql).toContain('uptime_percent');
  });

  it('validates 008_create_rollup_log.sql schema', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/008_create_rollup_log.sql'), 'utf8');
    expect(sql).toContain("rollup_type IN ('raw_to_hourly', 'hourly_to_daily')");
    expect(sql).toContain('unique_rollup_type_window');
  });
});
