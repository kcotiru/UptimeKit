import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Soft Delete and Purge Integration Tests', () => {
  it('verifies deletion queue table and monitors soft-delete flags', () => {
    const monitorsSql = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/003_create_monitors.sql'), 'utf8');
    const queueSql = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/009_create_deletion_queue.sql'), 'utf8');

    expect(monitorsSql).toContain('is_deleted BOOLEAN NOT NULL DEFAULT false');
    expect(monitorsSql).toContain('deleted_at TIMESTAMPTZ');
    expect(queueSql).toContain('batches_processed INTEGER NOT NULL DEFAULT 0');
  });
});
