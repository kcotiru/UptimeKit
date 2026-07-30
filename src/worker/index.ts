import { Worker } from 'bullmq';
import { dbPool, redisConnection } from './config/redis';
import { workerConfig } from './config/worker-config';
import { pingQueue, PING_QUEUE_NAME } from './queues/ping-queue';
import { ROLLUP_QUEUE_NAME, setupRollupSchedulers } from './queues/rollup-queue';
import { PURGE_QUEUE_NAME } from './queues/purge-queue';
import { SSRFValidator } from '../shared/security/ssrf-validator';
import { PingClient } from './http/ping-client';
import { PingProcessor } from './processors/ping-processor';
import { RollupProcessor } from './processors/rollup-processor';
import { PurgeProcessor } from './processors/purge-processor';
import { MonitorScheduler } from './schedulers/monitor-scheduler';

export interface WorkerService {
  pingWorker: Worker;
  rollupWorker: Worker;
  purgeWorker: Worker;
  syncInterval: NodeJS.Timeout;
}

/**
 * Main entry point for the UptimeKit background worker engine service.
 */
export async function startWorkerService(): Promise<WorkerService> {
  console.log('[Worker] Starting UptimeKit Background Worker Engine...');

  const ssrfValidator = new SSRFValidator(workerConfig.ssrfAllowlist);
  const pingClient = new PingClient();

  const pingProcessor = new PingProcessor(ssrfValidator, pingClient, dbPool);
  const rollupProcessor = new RollupProcessor(dbPool);
  const purgeProcessor = new PurgeProcessor(dbPool);

  const monitorScheduler = new MonitorScheduler(dbPool, pingQueue);

  // 1. Instantiate BullMQ Workers
  const pingWorker = new Worker(
    PING_QUEUE_NAME,
    async (job) => {
      return await pingProcessor.processPing(job.data);
    },
    {
      connection: redisConnection,
      concurrency: workerConfig.workerConcurrency,
    }
  );

  const rollupWorker = new Worker(
    ROLLUP_QUEUE_NAME,
    async (job) => {
      return await rollupProcessor.processRollup(job.data);
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  const purgeWorker = new Worker(
    PURGE_QUEUE_NAME,
    async (job) => {
      return await purgeProcessor.processPurge(job.data);
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  // 2. Setup Repeatable Schedulers
  await setupRollupSchedulers();
  await monitorScheduler.syncMonitors();

  const syncInterval = setInterval(() => {
    monitorScheduler.syncMonitors().catch((err: unknown) => {
      console.error('[Scheduler] Monitor sync failed:', err);
    });
  }, workerConfig.schedulerSyncIntervalMs);

  console.log('[Worker] Engine initialization complete. Listening for queue jobs...');

  // Graceful shutdown handler
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Worker] Received ${signal}. Shutting down worker engine gracefully...`);
    clearInterval(syncInterval);

    await pingWorker.close();
    await rollupWorker.close();
    await purgeWorker.close();
    await dbPool.end();
    await redisConnection.quit();

    console.log('[Worker] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  return { pingWorker, rollupWorker, purgeWorker, syncInterval };
}

if (require.main === module) {
  startWorkerService().catch((err: unknown) => {
    console.error('[Worker] Fatal error during worker service startup:', err);
    process.exit(1);
  });
}
