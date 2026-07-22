import { Pool } from "pg";
import { PingLog, HourlyMonitorStat } from "../domain/models";

export class PingLogDao {
  constructor(private db: Pool) { }

  private mapRowToPingLog(row: any): PingLog {
    return {
      time: row.time,
      monitorId: row.monitor_id,
      statusCode: row.status_code,
      responseMs: row.response_ms,
      isUp: row.is_up,
      errorMessage: row.error_message,
    };
  }

  private mapRowToHourlyStat(row: any): HourlyMonitorStat {
    return {
      bucket: row.bucket,
      monitorId: row.monitor_id,
      avgResponseMs: row.avg_response_ms,
      minResponseMs: row.min_response_ms,
      maxResponseMs: row.max_response_ms,
      uptimePercentage: row.uptime_percentage !== null ? parseFloat(row.uptime_percentage) : null,
    };
  }

  async insertLog(log: PingLog): Promise<void> {
    const query = `
      INSERT INTO ping_logs (time, monitor_id, response_ms, status_code, is_up, error_message)
      VALUES ($1, $2, $3, $4, $5, $6);
    `;
    const values = [
      log.time,
      log.monitorId,
      log.responseMs,
      log.statusCode,
      log.isUp,
      log.errorMessage,
    ];
    await this.db.query(query, values);
  }

  async insertLogsBatch(logs: PingLog[]): Promise<void> {
    if (logs.length === 0) return;

    const values: any[] = [];
    const valueTuples: string[] = [];

    logs.forEach((log, index) => {
      const offset = index * 6;
      valueTuples.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
      values.push(log.time, log.monitorId, log.responseMs, log.statusCode, log.isUp, log.errorMessage);
    });

    const query = `
      INSERT INTO ping_logs (time, monitor_id, response_ms, status_code, is_up, error_message)
      VALUES ${valueTuples.join(", ")};
    `;

    await this.db.query(query, values);
  }

  async getHourlyStats(monitorId: string, limitHours: number = 24): Promise<HourlyMonitorStat[]> {
    const query = `
      SELECT bucket, monitor_id, avg_response_ms, min_response_ms, max_response_ms, uptime_percentage
      FROM hourly_monitor_stats
      WHERE monitor_id = $1
      ORDER BY bucket DESC
      LIMIT $2;
    `;
    const result = await this.db.query(query, [monitorId, limitHours]);
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
    const result = await this.db.query(query, [monitorId, limit]);
    return result.rows.map((row) => this.mapRowToPingLog(row));
  }
}
