import { Pool } from "pg";
import format from "pg-format";
import { PingLog, HourlyMonitorStat } from "../domain/models";
import { BaseDao } from "./base-dao";

export class PingLogDao extends BaseDao<PingLog> {
  constructor(db: Pool) {
    super(db);
  }

  protected mapRow(row: any): PingLog {
    return {
      time: row.time,
      monitorId: row.monitor_id,
      statusCode: row.status_code,
      responseMs: row.response_ms,
      isUp: row.is_up,
    };
  }

  private mapRowToHourlyStat(row: any): HourlyMonitorStat {
    return {
      bucket: row.bucket,
      monitorId: row.monitor_id,
      avgResponseMs: row.avg_response_ms,
      minResponseMs: row.min_response_ms,
      maxResponseMs: row.max_response_ms,
      p95ResponseMs: row.p95_response_ms,
    };
  }

  async insertLog(log: PingLog): Promise<void> {
    const query = `
      INSERT INTO ping_logs (time, monitor_id, response_ms, status_code, is_up)
      VALUES ($1, $2, $3, $4, $5);
    `;
    const values = [
      log.time,
      log.monitorId,
      log.responseMs,
      log.statusCode,
      log.isUp,
    ];
    await this.execute(query, values);
  }

  async insertLogsBatch(logs: PingLog[]): Promise<void> {
    if (logs.length === 0) return;

    const values = logs.map((log) => [
      log.time,
      log.monitorId,
      log.responseMs,
      log.statusCode,
      log.isUp,
    ]);

    const query = format(
      `INSERT INTO ping_logs (time, monitor_id, response_ms, status_code, is_up) VALUES %L`,
      values
    );

    await this.execute(query);
  }

  async getHourlyStats(monitorId: string, limitHours: number = 24): Promise<HourlyMonitorStat[]> {
    const query = `
      SELECT bucket, monitor_id, avg_response_ms, min_response_ms, max_response_ms, p95_response_ms
      FROM hourly_monitor_stats
      WHERE monitor_id = $1
      ORDER BY bucket DESC
      LIMIT $2;
    `;
    const result = await this.execute(query, [monitorId, limitHours]);
    return result.rows.map((row) => this.mapRowToHourlyStat(row));
  }

  async getRecentRawLogs(monitorId: string, limit: number = 50): Promise<PingLog[]> {
    const query = `
      SELECT *
      FROM ping_logs
      WHERE monitor_id = $1
      ORDER BY time DESC
      LIMIT $2;
    `;
    return this.queryMany(query, [monitorId, limit]);
  }
}
