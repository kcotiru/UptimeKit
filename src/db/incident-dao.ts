import { Pool } from "pg";
import { Incident } from "../domain/models";

export class IncidentDao {
  constructor(private db: Pool) { }

  private mapRowToIncident(row: any): Incident {
    return {
      id: row.id,
      monitorId: row.monitor_id,
      startedAt: row.started_at,
      resolvedAt: row.resolved_at,
      cause: row.cause,
      status: row.status,
    };
  }

  async createIncident(monitorId: string, cause?: string): Promise<Incident> {
    const query = `
      INSERT INTO incidents (monitor_id, cause, status)
      VALUES ($1, $2, 'ONGOING')
      RETURNING *;
    `;
    const result = await this.db.query(query, [monitorId, cause ?? null]);
    return this.mapRowToIncident(result.rows[0]);
  }

  async getOngoingIncident(monitorId: string): Promise<Incident | null> {
    const query = `
      SELECT * FROM incidents
      WHERE monitor_id = $1 AND status = 'ONGOING'
      ORDER BY started_at DESC
      LIMIT 1;
    `;
    const result = await this.db.query(query, [monitorId]);
    if (!result.rows[0]) return null;
    return this.mapRowToIncident(result.rows[0]);
  }

  async resolveIncident(id: string): Promise<void> {
    const query = `
      UPDATE incidents
      SET status = 'RESOLVED', resolved_at = NOW()
      WHERE id = $1;
    `;
    await this.db.query(query, [id]);
  }

  async getIncidentsByMonitor(monitorId: string, limit: number = 20): Promise<Incident[]> {
    const query = `
      SELECT * FROM incidents
      WHERE monitor_id = $1
      ORDER BY started_at DESC
      LIMIT $2;
    `;
    const result = await this.db.query(query, [monitorId, limit]);
    return result.rows.map((row) => this.mapRowToIncident(row));
  }
}
