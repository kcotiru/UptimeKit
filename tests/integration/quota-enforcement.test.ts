import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Quota Enforcement Tests', () => {
  it('validates quota_limits column on teams table', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('quota_limits JSONB');
  });
});
