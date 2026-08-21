import { describe, it, expect, vi } from 'vitest';
import { PingProcessor } from '../../src/worker/processors/ping-processor';
import { RollupProcessor } from '../../src/worker/processors/rollup-processor';
import { PurgeProcessor } from '../../src/worker/processors/purge-processor';

describe('E2E Worker Execution Flow', () => {
  it('executes full pipeline: Ping -> Rollup -> Purge', async () => {
    const mockDbClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('BEGIN') || sql.includes('COMMIT')) return Promise.resolve();
        if (sql.includes('INSERT INTO ping_logs_raw')) return Promise.resolve({ rowCount: 1 });
        if (sql.includes('UPDATE monitors')) return Promise.resolve({ rowCount: 1, rows: [{ consecutive_failures: 0 }] });
        if (sql.includes('SELECT status FROM rollup_logs')) return Promise.resolve({ rows: [] });
        if (sql.includes('pg_try_advisory_xact_lock')) return Promise.resolve({ rows: [{ acquired: true }] });
        if (sql.includes('INSERT INTO ping_logs_hourly')) return Promise.resolve({ rowCount: 1 });
        if (sql.includes('INSERT INTO rollup_logs')) return Promise.resolve({ rowCount: 1 });
        if (sql.includes('UPDATE deletion_queue SET status = \'processing\'')) return Promise.resolve({ rowCount: 1 });
        if (sql.includes('DELETE FROM ping_logs_raw')) return Promise.resolve({ rowCount: 5 });
        if (sql.includes('DELETE FROM ping_logs_hourly')) return Promise.resolve({ rowCount: 0 });
        if (sql.includes('DELETE FROM ping_logs_daily')) return Promise.resolve({ rowCount: 0 });
        if (sql.includes('UPDATE deletion_queue SET status = \'completed\'')) return Promise.resolve({ rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };

    const mockDbPool: any = {
      connect: vi.fn().mockResolvedValue(mockDbClient),
      query: vi.fn(),
    };

    const mockSsrfValidator = {
      validateUrl: vi.fn().mockResolvedValue({ isAllowed: true, resolvedIp: '93.184.216.34' }),
    };

    const mockPingClient = {
      executePing: vi.fn().mockResolvedValue({
        responseTimeMs: 85,
        statusCode: 200,
        errorMessage: null,
      }),
    };

    const pingProc = new PingProcessor(mockSsrfValidator as any, mockPingClient as any, mockDbPool, { add: vi.fn() } as any);
    const rollupProc = new RollupProcessor(mockDbPool);
    const purgeProc = new PurgeProcessor(mockDbPool);

    // Step 1: Ping
    const pingRes = await pingProc.processPing({
      monitorId: 'm1',
      teamId: 't1',
      url: 'https://example.com',
      expectedStatus: 200,
      checkInterval: 30,
    });
    expect(pingRes.status).toBe('up');

    // Step 2: Rollup
    const rollupRes = await rollupProc.processRollup({
      rollupType: 'raw_to_hourly',
      timeWindow: '2026-07-27T08:00:00Z',
    });
    expect(rollupRes.status).toBe('completed');

    // Step 3: Purge
    const purgeRes = await purgeProc.processPurge({
      deletionQueueId: 'dq1',
      monitorId: 'm1',
      batchSize: 500,
    });
    expect(purgeRes.completed).toBe(true);
  });
});
