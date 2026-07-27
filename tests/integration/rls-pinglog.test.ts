import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('RLS PingLog and Resource Policies Verification', () => {
  it('validates 011_enable_rls_pinglog.sql policy names and team isolation', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/011_enable_rls_pinglog.sql'), 'utf8');
    expect(sql).toContain('tenant_isolation_raw');
    expect(sql).toContain('tenant_isolation_hourly');
    expect(sql).toContain('tenant_isolation_daily');
  });

  it('validates 013_enable_rls_users.sql policy names', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/013_enable_rls_users.sql'), 'utf8');
    expect(sql).toContain('tenant_isolation_users');
  });
});
