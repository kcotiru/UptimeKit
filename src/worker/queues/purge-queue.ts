import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { PurgeJobPayload } from './types';

export const PURGE_QUEUE_NAME = 'uptimekit-purge-queue';

/**
 * BullMQ Queue for soft-deleted monitor log purge jobs.
 */
export const purgeQueue = new Queue<PurgeJobPayload>(PURGE_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
