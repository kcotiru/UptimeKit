import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Row-Level Security Integration / Validation Tests', () => {
  it('validates 010_enable_rls_monitors.sql policy structure', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/010_enable_rls_monitors.sql'), 'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('tenant_isolation_monitors');
    expect(sql).toContain("app.current_team_id");
  });

  it('validates 010 reverse migration', () => {
    const downSql = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/down/010_drop_rls_monitors.sql'), 'utf8');
    expect(downSql).toContain('DROP POLICY IF EXISTS tenant_isolation_monitors ON monitors');
    expect(downSql).toContain('DISABLE ROW LEVEL SECURITY');
  });
});
