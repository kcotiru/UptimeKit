import { Pool } from 'pg';
import { Queue } from 'bullmq';
import { PingJobPayload, PurgeJobPayload } from '../queues/types';

export interface IMonitorScheduler {
  syncMonitors(): Promise<{ added: number; updated: number; removed: number }>;
  scheduleMonitor(monitor: {
    id: string;
    teamId: string;
    url: string;
    expectedStatus: number;
    checkInterval: number;
  }): Promise<void>;
  unscheduleMonitor(monitorId: string): Promise<void>;
}

export class MonitorScheduler implements IMonitorScheduler {
  private dbPool: Pool;
  private queue: Queue<PingJobPayload>;

  constructor(dbPool: Pool, queue: Queue<PingJobPayload>) {
    this.dbPool = dbPool;
    this.queue = queue;
  }

  /**
   * Upserts a single monitor's job schedule into BullMQ.
   */
  async scheduleMonitor(monitor: {
    id: string;
    teamId: string;
    url: string;
    expectedStatus: number;
    checkInterval: number;
  }): Promise<void> {
    const schedulerId = `monitor:${monitor.id}`;
    const intervalMs = Math.max(monitor.checkInterval * 1000, 1000);

    const payload: PingJobPayload = {
      monitorId: monitor.id,
      teamId: monitor.teamId,
      url: monitor.url,
      expectedStatus: monitor.expectedStatus,
      checkInterval: monitor.checkInterval,
    };

    await this.queue.upsertJobScheduler(
      schedulerId,
      { every: intervalMs },
      {
        name: 'ping-check',
        data: payload,
      }
    );
  }

  /**
   * Removes a monitor's repeatable job from BullMQ.
   */
  async unscheduleMonitor(monitorId: string): Promise<void> {
    const schedulerId = `monitor:${monitorId}`;
    await this.queue.removeJobScheduler(schedulerId);
  }

  /**
   * Syncs active monitors from PostgreSQL into BullMQ repeatable jobs.
   */
  async syncMonitors(): Promise<{ added: number; updated: number; removed: number }> {
    const query = `
      SELECT id, team_id, url, expected_status, check_interval
      FROM monitors
      WHERE is_paused = false AND deleted_at IS NULL
    `;
    const { rows } = await this.dbPool.query(query);

    const activeIds = new Set<string>();
    let added = 0;
    const updated = 0;

    for (const row of rows) {
      const monitor = {
        id: row.id,
        teamId: row.team_id,
        url: row.url,
        expectedStatus: row.expected_status || 200,
        checkInterval: row.check_interval || 60,
      };
      activeIds.add(monitor.id);
      await this.scheduleMonitor(monitor);
      added++;
    }

    // Clean up schedulers for monitors that are no longer active
    const schedulers = await this.queue.getJobSchedulers();
    let removed = 0;

    for (const s of schedulers) {
      if (s.id && s.id.startsWith('monitor:')) {
        const monitorId = s.id.replace('monitor:', '');
        if (!activeIds.has(monitorId)) {
          await this.queue.removeJobScheduler(s.id);
          removed++;
        }
      }
    }

    return { added, updated, removed };
  }
}

/**
 * Hands rows the soft-delete trigger queued to the purge worker. The
 * UPDATE ... RETURNING is the claim, so overlapping ticks can't enqueue a row
 * twice; a failed enqueue puts it back to pending for the next tick.
 */
export async function enqueuePendingPurges(
  dbPool: Pool,
  queue: Queue<PurgeJobPayload>
): Promise<number> {
  const { rows } = await dbPool.query(
    `UPDATE deletion_queue SET status = 'processing', updated_at = NOW()
     WHERE status = 'pending'
     RETURNING id, monitor_id`
  );

  let enqueued = 0;
  for (const row of rows) {
    try {
      await queue.add('purge-monitor', { deletionQueueId: row.id, monitorId: row.monitor_id });
      enqueued++;
    } catch (err: unknown) {
      await dbPool.query(`UPDATE deletion_queue SET status = 'pending' WHERE id = $1`, [row.id]);
      console.error(`[Purge] Failed to enqueue purge for monitor ${row.monitor_id}:`, err);
    }
  }

  return enqueued;
}
