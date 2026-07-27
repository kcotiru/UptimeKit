import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Quota Enforcement Tests', () => {
  it('validates quota_limits column on teams table', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/001_create_teams.sql'), 'utf8');
    expect(sql).toContain('quota_limits JSONB');
  });
});
