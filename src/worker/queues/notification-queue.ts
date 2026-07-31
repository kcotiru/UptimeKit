import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { NotificationJobPayload } from './types';

export const NOTIFICATION_QUEUE_NAME = 'notification-queue';

export const notificationQueue = new Queue<NotificationJobPayload>(NOTIFICATION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 240000, // 4 mins initial, doubling to ~1 hour cumulative across 5 attempts
    },
  },
});
