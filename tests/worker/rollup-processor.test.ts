import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RollupProcessor } from '../../src/worker/processors/rollup-processor';
import { RollupJobPayload } from '../../src/worker/queues/types';

describe('RollupProcessor', () => {
  let mockDbClient: any;
  let mockDbPool: any;
  let processor: RollupProcessor;

  beforeEach(() => {
    mockDbClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockDbPool = {
      connect: vi.fn().mockResolvedValue(mockDbClient),
      query: vi.fn(),
    };
    processor = new RollupProcessor(mockDbPool);
  });

  it('executes raw_to_hourly rollup, saves aggregates, purges >7d raw logs, and logs status completed', async () => {
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve();
      if (sql.includes('SELECT status FROM rollup_logs')) return Promise.resolve({ rows: [] });
      if (sql.includes('pg_try_advisory_xact_lock')) return Promise.resolve({ rows: [{ acquired: true }] });
      if (sql.includes('INSERT INTO ping_logs_hourly')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('DELETE FROM ping_logs_raw')) return Promise.resolve({ rowCount: 0 });
      if (sql.includes('INSERT INTO rollup_logs')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('COMMIT')) return Promise.resolve();
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const jobData: RollupJobPayload = {
      rollupType: 'raw_to_hourly',
      timeWindow: '2026-07-27T08:00:00Z',
    };

    const result = await processor.processRollup(jobData);
    expect(result.status).toBe('completed');
    expect(result.outputCount).toBe(1);
  });

  it('skips rollup idempotently if already completed', async () => {
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve();
      if (sql.includes('SELECT status FROM rollup_logs')) return Promise.resolve({ rows: [{ status: 'completed' }] });
      if (sql.includes('ROLLBACK')) return Promise.resolve();
      return Promise.resolve({ rows: [] });
    });

    const jobData: RollupJobPayload = {
      rollupType: 'raw_to_hourly',
      timeWindow: '2026-07-27T08:00:00Z',
    };

    const result = await processor.processRollup(jobData);
    expect(result.status).toBe('skipped');
  });

  it('executes hourly_to_daily rollup and purges >90d hourly logs', async () => {
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve();
      if (sql.includes('SELECT status FROM rollup_logs')) return Promise.resolve({ rows: [] });
      if (sql.includes('pg_try_advisory_xact_lock')) return Promise.resolve({ rows: [{ acquired: true }] });
      if (sql.includes('INSERT INTO ping_logs_daily')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('DELETE FROM ping_logs_hourly')) return Promise.resolve({ rowCount: 0 });
      if (sql.includes('INSERT INTO rollup_logs')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('COMMIT')) return Promise.resolve();
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const jobData: RollupJobPayload = {
      rollupType: 'hourly_to_daily',
      timeWindow: '2026-07-27T00:00:00Z',
    };

    const result = await processor.processRollup(jobData);
    expect(result.status).toBe('completed');
    expect(result.outputCount).toBe(1);
  });
});
