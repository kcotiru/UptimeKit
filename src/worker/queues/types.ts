/**
 * Job payload dispatched to ping-queue for HTTP health checks.
 */
export interface PingJobPayload {
  monitorId: string;
  teamId: string;
  url: string;
  expectedStatus: number;
  checkInterval: number;
}

/**
 * Scheduled job payload for rollup workers.
 */
export interface RollupJobPayload {
  rollupType: 'raw_to_hourly' | 'hourly_to_daily';
  timeWindow: string;
}

/**
 * Job payload for cleaning soft-deleted monitor logs.
 */
export interface PurgeJobPayload {
  deletionQueueId: string;
  monitorId: string;
  batchSize?: number;
}

/**
 * Structured result of an HTTP health check.
 */
export interface PingExecutionResult {
  monitorId: string;
  teamId: string;
  timestamp: Date;
  responseTimeMs: number;
  statusCode: number | null;
  errorMessage: string | null;
  status: 'up' | 'down' | 'degraded';
}

export interface NotificationJobPayload {
  teamId: string;
  monitorId: string;
  incidentId: string;
  status: 'down' | 'up';
  cause: string;
}