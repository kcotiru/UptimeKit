import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Tier Query Function SQL Validation', () => {
  it('validates select_ping_tier SQL structure and tier boundaries', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../src/db/scripts/tier-query-functions.sql'), 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION select_ping_tier');
    expect(sql).toContain("INTERVAL '7 days'");
    expect(sql).toContain("INTERVAL '90 days'");
    expect(sql).toContain("'raw'");
    expect(sql).toContain("'hourly'");
    expect(sql).toContain("'daily'");
  });
});
