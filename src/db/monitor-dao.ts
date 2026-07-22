import { Pool } from "pg";
import { Monitor } from "../domain/models";

export class MonitorDao {
  constructor(private db: Pool) { }

  private mapRowToMonitor(row: any): Monitor {
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      url: row.url,
      type: row.type,
      intervalSec: row.interval_sec,
      expectedStatusCode: row.expected_status_code,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  }

  async createMonitor(monitor: Omit<Monitor, 'id' | 'createdAt'>): Promise<Monitor> {
    const query = `
      INSERT INTO monitors (team_id, name, url, type, interval_sec, expected_status_code, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      monitor.teamId,
      monitor.name,
      monitor.url,
      monitor.type ?? 'HTTP',
      monitor.intervalSec ?? 60,
      monitor.expectedStatusCode ?? 200,
      monitor.isActive ?? true
    ];

    const result = await this.db.query(query, values);
    return this.mapRowToMonitor(result.rows[0]);
  }

  async getMonitorsByTeamId(teamId: string): Promise<Monitor[]> {
    const query = `
      SELECT *
      FROM monitors
      WHERE team_id = $1
      ORDER BY created_at DESC;
    `;
    const result = await this.db.query(query, [teamId]);
    return result.rows.map((row) => this.mapRowToMonitor(row));
  }

  async getActiveMonitors(): Promise<Monitor[]> {
    const query = `
      SELECT *
      FROM monitors
      WHERE is_active = TRUE
    `;
    const result = await this.db.query(query);
    return result.rows.map((row) => this.mapRowToMonitor(row));
  }

  async updateMonitorStatus(id: string, isActive: boolean): Promise<void> {
    const query = `
      UPDATE monitors
      SET is_active = $1
      WHERE id = $2
    `;
    await this.db.query(query, [isActive, id]);
  }
}
