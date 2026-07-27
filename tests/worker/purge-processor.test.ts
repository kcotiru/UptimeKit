import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PurgeProcessor } from '../../src/worker/processors/purge-processor';
import { PurgeJobPayload } from '../../src/worker/queues/types';

describe('PurgeProcessor', () => {
  let mockDbClient: any;
  let mockDbPool: any;
  let processor: PurgeProcessor;

  beforeEach(() => {
    mockDbClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockDbPool = {
      connect: vi.fn().mockResolvedValue(mockDbClient),
      query: vi.fn(),
    };
    processor = new PurgeProcessor(mockDbPool);
  });

  it('deletes orphaned logs in batches and sets deletion_queue status to completed', async () => {
    mockDbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve();
      if (sql.includes('UPDATE deletion_queue SET status = \'processing\'')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('DELETE FROM ping_logs_raw')) return Promise.resolve({ rowCount: 10 });
      if (sql.includes('DELETE FROM ping_logs_hourly')) return Promise.resolve({ rowCount: 0 });
      if (sql.includes('DELETE FROM ping_logs_daily')) return Promise.resolve({ rowCount: 0 });
      if (sql.includes('UPDATE deletion_queue SET status = \'completed\'')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('COMMIT')) return Promise.resolve();
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const jobData: PurgeJobPayload = {
      deletionQueueId: 'dq1',
      monitorId: 'm1',
      batchSize: 500,
    };

    const result = await processor.processPurge(jobData);
    expect(result.completed).toBe(true);
    expect(result.deletedCount).toBe(10);
    expect(mockDbClient.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE deletion_queue SET status = 'completed'"),
      ['dq1']
    );
  });
});
