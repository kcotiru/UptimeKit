import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { RollupJobPayload } from './types';

export const ROLLUP_QUEUE_NAME = 'uptimekit-rollup-queue';

/**
 * BullMQ Queue for scheduled statistical rollup jobs.
 */
export const rollupQueue = new Queue<RollupJobPayload>(ROLLUP_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: 200,
  },
});

/**
 * Registers recurring hourly and daily rollup cron jobs.
 */
export async function setupRollupSchedulers(): Promise<void> {
  // Hourly rollup runs at minute 0 of every hour
  await rollupQueue.upsertJobScheduler(
    'rollup:raw_to_hourly',
    { pattern: '0 * * * *' },
    {
      name: 'rollup-hourly',
      // No timeWindow: repeatable job data is static, so the processor derives
      // the closed hour at fire time instead of replaying one baked-in window.
      data: { rollupType: 'raw_to_hourly' },
    }
  );

  // Daily rollup runs at 01:00 UTC daily
  await rollupQueue.upsertJobScheduler(
    'rollup:hourly_to_daily',
    { pattern: '0 1 * * *' },
    {
      name: 'rollup-daily',
      data: { rollupType: 'hourly_to_daily' },
    }
  );
}
