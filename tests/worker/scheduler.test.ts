import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorScheduler } from '../../src/worker/schedulers/monitor-scheduler';

describe('MonitorScheduler', () => {
  let mockDbPool: any;
  let mockQueue: any;
  let scheduler: MonitorScheduler;

  beforeEach(() => {
    mockDbPool = {
      query: vi.fn(),
    };
    mockQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(true),
      removeJobScheduler: vi.fn().mockResolvedValue(true),
      getJobSchedulers: vi.fn().mockResolvedValue([]),
    };
    scheduler = new MonitorScheduler(mockDbPool, mockQueue);
  });

  it('schedules active monitors from database', async () => {
    mockDbPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'm1', team_id: 't1', url: 'https://a.com', expected_status: 200, check_interval: 30 },
        { id: 'm2', team_id: 't1', url: 'https://b.com', expected_status: 200, check_interval: 60 },
      ],
    });

    const result = await scheduler.syncMonitors();
    expect(result.added).toBe(2);
    expect(mockQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
      'monitor:m1',
      { every: 30000 },
      expect.objectContaining({ name: 'ping-check' })
    );
  });

  it('unschedules monitors no longer active in database', async () => {
    mockDbPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'm1', team_id: 't1', url: 'https://a.com', expected_status: 200, check_interval: 30 },
      ],
    });

    mockQueue.getJobSchedulers.mockResolvedValueOnce([
      { id: 'monitor:m1' },
      { id: 'monitor:m2_deleted' },
    ]);

    const result = await scheduler.syncMonitors();
    expect(result.removed).toBe(1);
    expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith('monitor:m2_deleted');
  });

  it('unschedules single monitor by id', async () => {
    await scheduler.unscheduleMonitor('m1');
    expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith('monitor:m1');
  });

  it('forwards each monitor timeout into the ping job payload', async () => {
    const dbPool: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'm1', team_id: 't1', url: 'https://a.test', expected_status: 200, check_interval: 60, timeout_ms: 1500 }],
      }),
    };
    const queue: any = {
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
      getJobSchedulers: vi.fn().mockResolvedValue([]),
    };

    await new MonitorScheduler(dbPool, queue).syncMonitors();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'monitor:m1',
      { every: 60000 },
      expect.objectContaining({ data: expect.objectContaining({ timeoutMs: 1500 }) })
    );
  });
});
