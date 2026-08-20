import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Rollup Schema and Logic Validation Tests', () => {
  // Column names must match what rollup-processor.ts INSERTs and ON CONFLICTs against.
  it('validates the hourly tier schema', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('avg_response_time_ms');
    expect(sql).toContain('p50_response_time_ms');
    expect(sql).toContain('p95_response_time_ms');
    expect(sql).toContain('p99_response_time_ms');
  });

  it('validates the daily tier schema and its upsert key', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('bucket_start');
    expect(sql).toContain('total_pings');
    expect(sql).toContain('successful_pings');
    expect(sql).toContain('PRIMARY KEY (team_id, monitor_id, bucket_start)');
  });

  it('validates 008_create_rollup_log.sql schema', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain("rollup_type IN ('raw_to_hourly', 'hourly_to_daily')");
    expect(sql).toContain('unique_rollup_type_window');
  });
});
