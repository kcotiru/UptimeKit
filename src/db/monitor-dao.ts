import { Pool } from "pg";
import { Monitor } from "../domain/models";
import { BaseDao } from "./base-dao";

export class MonitorDao extends BaseDao<Monitor> {
  constructor(db: Pool) {
    super(db);
  }

  protected mapRow(row: any): Monitor {
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

    return (await this.querySingle(query, values))!;
  }

  async getMonitorsByTeamId(teamId: string): Promise<Monitor[]> {
    const query = `
      SELECT *
      FROM monitors
      WHERE team_id = $1
      ORDER BY created_at DESC;
    `;
    return this.queryMany(query, [teamId]);
  }

  async getActiveMonitors(): Promise<Monitor[]> {
    const query = `
      SELECT *
      FROM monitors
      WHERE is_active = TRUE
    `;
    return this.queryMany(query);
  }

  async updateMonitorStatus(id: string, isActive: boolean): Promise<void> {
    const query = `
      UPDATE monitors
      SET is_active = $1
      WHERE id = $2
    `;
    await this.execute(query, [isActive, id]);
  }
}
