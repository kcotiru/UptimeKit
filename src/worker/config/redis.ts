import Redis from 'ioredis';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { workerConfig } from './worker-config';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Shared Redis client connection for BullMQ.
 */
export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

/**
 * BullMQ default connection configuration options.
 */
export const defaultBullMQConnection = {
  connection: redisConnection,
};

const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/uptimekit_dev';

/**
 * PostgreSQL connection pool configured to match or exceed worker concurrency limit.
 */
export const dbPool = new Pool({
  connectionString: dbUrl,
  max: Math.max(workerConfig.workerConcurrency, 50),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
