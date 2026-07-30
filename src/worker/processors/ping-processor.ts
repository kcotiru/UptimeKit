import { Pool } from 'pg';
import { ISSRFValidator } from '../../shared/security/ssrf-validator';
import { IPingClient } from '../http/ping-client';
import { PingJobPayload, PingExecutionResult } from '../queues/types';
import { workerConfig } from '../config/worker-config';

export interface IPingProcessor {
  processPing(jobData: PingJobPayload): Promise<PingExecutionResult>;
}

export class PingProcessor implements IPingProcessor {
  private ssrfValidator: ISSRFValidator;
  private pingClient: IPingClient;
  private dbPool: Pool;

  constructor(ssrfValidator: ISSRFValidator, pingClient: IPingClient, dbPool: Pool) {
    this.ssrfValidator = ssrfValidator;
    this.pingClient = pingClient;
    this.dbPool = dbPool;
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
        SET status = $1, updated_at = NOW()
        WHERE id = $2 AND team_id = $3 AND deleted_at IS NULL
      `;
      await client.query(updateQuery, [
        executionResult.status,
        executionResult.monitorId,
        executionResult.teamId,
      ]);

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
