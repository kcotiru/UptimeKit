import { describe, it, expect, vi } from 'vitest';
import { closedBucket } from '../../src/worker/processors/rollup-processor';
import { enqueuePendingPurges } from '../../src/worker/schedulers/monitor-scheduler';

describe('closedBucket', () => {
  it('rolls up the UTC hour that just closed, not the firing hour', () => {
    expect(closedBucket('raw_to_hourly', new Date('2026-08-20T14:00:03.412Z')))
      .toBe('2026-08-20T13:00:00.000Z');
  });

  it('rolls up the previous UTC day, crossing the month boundary', () => {
    expect(closedBucket('hourly_to_daily', new Date('2026-09-01T01:00:00Z')))
      .toBe('2026-08-31T00:00:00.000Z');
  });

  it('advances every hour — the bug was one static window replayed forever', () => {
    const a = closedBucket('raw_to_hourly', new Date('2026-08-20T14:00:00Z'));
    const b = closedBucket('raw_to_hourly', new Date('2026-08-20T15:00:00Z'));
    expect(a).not.toBe(b);
  });
});

describe('enqueuePendingPurges', () => {
  const pendingRow = { id: 'dq1', monitor_id: 'm1' };

  it('claims pending rows and enqueues one purge job each', async () => {
    const dbPool: any = { query: vi.fn().mockResolvedValue({ rows: [pendingRow] }) };
    const queue: any = { add: vi.fn().mockResolvedValue({}) };

    expect(await enqueuePendingPurges(dbPool, queue)).toBe(1);
    expect(queue.add).toHaveBeenCalledWith('purge-monitor', {
      deletionQueueId: 'dq1',
      monitorId: 'm1',
    });
    // The claim and the enqueue are one pass: no second UPDATE on success.
    expect(dbPool.query).toHaveBeenCalledTimes(1);
  });

  it('returns a row to pending when the enqueue fails', async () => {
    const dbPool: any = {
      query: vi.fn().mockResolvedValueOnce({ rows: [pendingRow] }).mockResolvedValue({ rows: [] }),
    };
    const queue: any = { add: vi.fn().mockRejectedValue(new Error('Redis down')) };

    expect(await enqueuePendingPurges(dbPool, queue)).toBe(0);
    expect(dbPool.query).toHaveBeenLastCalledWith(
      expect.stringContaining("SET status = 'pending'"),
      ['dq1']
    );
  });
});
