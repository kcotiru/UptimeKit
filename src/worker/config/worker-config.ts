import dotenv from 'dotenv';

dotenv.config();

/**
 * Worker engine configuration parameters.
 */
export const workerConfig = {
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '50', 10),
  defaultHttpTimeoutMs: parseInt(process.env.DEFAULT_HTTP_TIMEOUT_MS || '30000', 10),
  schedulerSyncIntervalMs: parseInt(process.env.SCHEDULER_SYNC_INTERVAL_MS || '30000', 10),
  maxMemoryMb: parseInt(process.env.MAX_MEMORY_MB || '512', 10),
  degradedThresholdMs: parseInt(process.env.DEGRADED_THRESHOLD_MS || '5000', 10),
  ssrfAllowlist: (process.env.SSRF_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean),
  defaultFailureThreshold: parseInt(process.env.ALERT_FAILURE_THRESHOLD || '3', 10),
};
