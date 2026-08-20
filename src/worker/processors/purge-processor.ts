import { Pool } from 'pg';
import { PurgeJobPayload } from '../queues/types';

export interface IPurgeProcessor {
  processPurge(jobData: PurgeJobPayload): Promise<{
    deletedCount: number;
    completed: boolean;
  }>;
}

export class PurgeProcessor implements IPurgeProcessor {
  private dbPool: Pool;

  constructor(dbPool: Pool) {
    this.dbPool = dbPool;
  }

  /**
   * Processes a deletion_queue item by batch deleting orphaned ping logs for soft-deleted monitors.
   */
  async processPurge(jobData: PurgeJobPayload): Promise<{
    deletedCount: number;
    completed: boolean;
  }> {
    const { deletionQueueId, monitorId, batchSize = 500 } = jobData;
    const client = await this.dbPool.connect();

    try {
      await client.query('BEGIN');

      // Update status to processing
      await client.query(
        `UPDATE deletion_queue SET status = 'processing' WHERE id = $1`,
        [deletionQueueId]
      );

      let totalDeleted = 0;

      // Batch delete from ping_logs_raw
      let rawDeleted = 0;
      do {
        const res = await client.query(
          `WITH to_delete AS (
             SELECT ctid FROM ping_logs_raw WHERE monitor_id = $1 LIMIT $2
           )
           DELETE FROM ping_logs_raw WHERE ctid IN (SELECT ctid FROM to_delete)`,
          [monitorId, batchSize]
        );
        rawDeleted = res.rowCount || 0;
        totalDeleted += rawDeleted;
      } while (rawDeleted >= batchSize);

      // Batch delete from ping_logs_hourly
      let hourlyDeleted = 0;
      do {
        const res = await client.query(
          `WITH to_delete AS (
             SELECT ctid FROM ping_logs_hourly WHERE monitor_id = $1 LIMIT $2
           )
           DELETE FROM ping_logs_hourly WHERE ctid IN (SELECT ctid FROM to_delete)`,
          [monitorId, batchSize]
        );
        hourlyDeleted = res.rowCount || 0;
        totalDeleted += hourlyDeleted;
      } while (hourlyDeleted >= batchSize);

      // Batch delete from ping_logs_daily
      let dailyDeleted = 0;
      do {
        const res = await client.query(
          `WITH to_delete AS (
             SELECT ctid FROM ping_logs_daily WHERE monitor_id = $1 LIMIT $2
           )
           DELETE FROM ping_logs_daily WHERE ctid IN (SELECT ctid FROM to_delete)`,
          [monitorId, batchSize]
        );
        dailyDeleted = res.rowCount || 0;
        totalDeleted += dailyDeleted;
      } while (dailyDeleted >= batchSize);

      // Mark deletion_queue item as completed
      await client.query(
        `UPDATE deletion_queue SET status = 'completed', processed_at = NOW() WHERE id = $1`,
        [deletionQueueId]
      );

      await client.query('COMMIT');
      return { deletedCount: totalDeleted, completed: true };
    } catch (err: unknown) {
      const error = err as Error;
      await client.query('ROLLBACK');

      // Back to 'pending' so the next drain tick retries: deletion_queue has no
      // 'failed' status and no error_message column, and logs that never purge
      // are worse than a repeated attempt (the deletes are idempotent).
      try {
        await this.dbPool.query(
          `UPDATE deletion_queue SET status = 'pending', updated_at = NOW() WHERE id = $1`,
          [deletionQueueId]
        );
      } catch (_ignoredError: unknown) {
        /* ignore requeue failure */
      }

      console.error(`[Purge] Purge of monitor ${monitorId} failed, requeued:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }
}
