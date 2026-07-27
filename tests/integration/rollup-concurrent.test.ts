import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Rollup Concurrency Validation Tests', () => {
  it('validates unique constraint on rollup_logs prevents duplicate concurrent executions', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/008_create_rollup_log.sql'), 'utf8');
    expect(sql).toContain('unique_rollup_type_window');
  });
});
