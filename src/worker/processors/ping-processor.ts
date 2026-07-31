import { Pool } from 'pg';
import { SSRFValidator } from '../../shared/security/ssrf-validator';
import { PingClient } from '../http/ping-client';
import { PingJobPayload, PingExecutionResult, NotificationJobPayload } from '../queues/types';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { workerConfig } from '../config/worker-config';

export class PingProcessor {
  private ssrfValidator: SSRFValidator;
  private pingClient: PingClient;
  private dbPool: Pool;
  private notificationQueue: Queue<NotificationJobPayload>;

  constructor(ssrfValidator: SSRFValidator, pingClient: PingClient, dbPool: Pool, notificationQueue: Queue<NotificationJobPayload>) {
    this.ssrfValidator = ssrfValidator;
    this.pingClient = pingClient;
    this.dbPool = dbPool;
    this.notificationQueue = notificationQueue;
  }

  /**
   * Processes a ping job: validates SSRF, executes HTTP ping, records log in ping_logs_raw,
   * and updates monitor status.
   */
  async processPing(jobData: PingJobPayload): Promise<PingExecutionResult> {
    const timestamp = new Date();
    const { monitorId, teamId, url, expectedStatus } = jobData;

    // 1. SSRF Pre-flight check
    const ssrfResult = await this.ssrfValidator.validateUrl(url, workerConfig.ssrfAllowlist);

    let executionResult: PingExecutionResult;

    if (!ssrfResult.isAllowed) {
      executionResult = {
        monitorId,
        teamId,
        timestamp,
        responseTimeMs: 0,
        statusCode: null,
        errorMessage: ssrfResult.reason || 'SSRF Security Violation',
        status: 'down',
      };
    } else {
      // 2. Execute HTTP Ping
      const response = await this.pingClient.executePing(
        url,
        ssrfResult.resolvedIp,
        workerConfig.defaultHttpTimeoutMs
      );

      let status: 'up' | 'down' | 'degraded' = 'up';

      if (response.errorMessage !== null) {
        status = 'down';
      } else if (response.statusCode !== expectedStatus) {
        status = 'down';
      } else if (response.responseTimeMs > workerConfig.degradedThresholdMs) {
        status = 'degraded';
      }

      const errorMessage =
        response.errorMessage ||
        (response.statusCode !== expectedStatus
          ? `Unexpected status code: ${response.statusCode} (expected ${expectedStatus})`
          : null);

      executionResult = {
        monitorId,
        teamId,
        timestamp,
        responseTimeMs: response.responseTimeMs,
        statusCode: response.statusCode,
        errorMessage,
        status,
      };
    }

    // 3. Database ingestion & status update via parameterized query
    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');

      const insertQuery = `
        INSERT INTO ping_logs_raw (monitor_id, team_id, timestamp, response_time_ms, status_code, error_message)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      await client.query(insertQuery, [
        executionResult.monitorId,
        executionResult.teamId,
        executionResult.timestamp,
        executionResult.responseTimeMs,
        executionResult.statusCode,
        executionResult.errorMessage,
      ]);

      const updateQuery = `
        UPDATE monitors
        SET status = $1, updated_at = NOW(),
            consecutive_failures = CASE WHEN $1 = 'down' THEN consecutive_failures + 1 ELSE 0 END
        WHERE id = $2 AND team_id = $3 AND deleted_at IS NULL
        RETURNING consecutive_failures
      `;
      const updateRes = await client.query(updateQuery, [
        executionResult.status,
        executionResult.monitorId,
        executionResult.teamId,
      ]);

      if (updateRes.rows.length > 0) {
        const consecutiveFailures = updateRes.rows[0].consecutive_failures;
        // ponytail: hardcoded threshold = 3 (YAGNI on configurable rules for now)
        const threshold = 3; 
        
        if (consecutiveFailures === threshold && executionResult.status === 'down') {
          // Open incident
          const incidentId = randomUUID();
          await client.query(
            'INSERT INTO incidents (id, team_id, monitor_id, cause) VALUES ($1, $2, $3, $4)',
            [incidentId, executionResult.teamId, executionResult.monitorId, executionResult.errorMessage || 'Unknown Error']
          );
          
          await this.notificationQueue.add('notify-down', {
            teamId: executionResult.teamId,
            monitorId: executionResult.monitorId,
            incidentId,
            status: 'down',
            cause: executionResult.errorMessage || 'Unknown Error'
          });
        } else if (consecutiveFailures === 0 && executionResult.status === 'up') {
          // Check for open incidents to resolve
          const openIncidents = await client.query(
            'SELECT id FROM incidents WHERE monitor_id = $1 AND resolved_at IS NULL AND is_deleted = false FOR UPDATE',
            [executionResult.monitorId]
          );
          
          if (openIncidents.rows.length > 0) {
            await client.query(
              'UPDATE incidents SET resolved_at = NOW(), updated_at = NOW() WHERE monitor_id = $1 AND resolved_at IS NULL',
              [executionResult.monitorId]
            );
            
            await this.notificationQueue.add('notify-up', {
              teamId: executionResult.teamId,
              monitorId: executionResult.monitorId,
              incidentId: openIncidents.rows[0].id,
              status: 'up',
              cause: 'Monitor recovered'
            });
          }
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return executionResult;
  }
}
