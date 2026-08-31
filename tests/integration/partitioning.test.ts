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

  it('fails the schema apply when the partition job did not actually register', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

    // pg_cron cannot run on any local harness (no Windows support, and the
    // local Postgres has no pg_cron row in pg_available_extensions), so the
    // only place this can be verified for real is at apply time on Supabase.
    // The schema must therefore assert its own postcondition rather than
    // trusting that cron.schedule() had the intended effect.
    expect(sql).toContain('FROM cron.job');
    expect(sql).toContain("WHERE jobname = 'uptimekit-partitions'");
    // \s+ not a literal space: the RAISE EXCEPTION in schema.sql wraps onto the
    // next line, and a whitespace-literal assertion would fail against a
    // perfectly correct implementation.
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'[^']*uptimekit-partitions/);
  });

  it('fences the whole pg_cron region with strip sentinels the test harness can find', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

    // db-setup.ts removes this region before applying the schema locally. It
    // used to anchor on the `$job$` dollar-quote, which silently stopped
    // covering anything added after cron.schedule(). Sentinels make the region
    // explicit, so extending it cannot desynchronise the two files.
    expect(sql).toContain('-- @local-test:strip-start (pg_cron)');
    expect(sql).toContain('-- @local-test:strip-end');
    // The sentinels must bracket every cron reference, or the stripped schema
    // still contains a statement that cannot run without the extension.
    const start = sql.indexOf('-- @local-test:strip-start (pg_cron)');
    const end = sql.indexOf('-- @local-test:strip-end');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const outsideSentinels = sql.slice(0, start) + sql.slice(end);
    expect(outsideSentinels).not.toContain('cron.');
    expect(outsideSentinels).not.toContain('pg_cron');
  });
});
