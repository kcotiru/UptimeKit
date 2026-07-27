import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { PingJobPayload } from './types';

export const PING_QUEUE_NAME = 'uptimekit:ping-queue';

/**
 * BullMQ Queue for HTTP ping jobs with default retries and exponential backoff.
 */
export const pingQueue = new Queue<PingJobPayload>(PING_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
