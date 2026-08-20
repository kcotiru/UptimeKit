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

const dbUrl = process.env.DATABASE_URL || '';

if (!dbUrl) {
  throw new Error('DATABASE_URL is required (Supabase → Project Settings → Database → Connection string)');
}

/**
 * PostgreSQL connection pool configured to match or exceed worker concurrency limit.
 * Connects straight to Supabase's Postgres — the worker is a trusted backend
 * process, so it bypasses row level security by design.
 */
export const dbPool = new Pool({
  connectionString: dbUrl,
  // Supabase requires TLS; its cert chain isn't in the local trust store.
  ssl: dbUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: Math.max(workerConfig.workerConcurrency, 50),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
