import { Pool } from "pg";
import { Incident } from "../domain/models";
import { BaseDao } from "./base-dao";

export enum IncidentStatus {
  ONGOING = 'ONGOING',
  RESOLVED = 'RESOLVED',
}

export class IncidentDao extends BaseDao<Incident> {
  constructor(db: Pool) {
    super(db);
  }

  protected mapRow(row: any): Incident {
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
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    return (await this.querySingle(query, [monitorId, cause ?? null, IncidentStatus.ONGOING]))!;
  }

  async getOngoingIncident(monitorId: string): Promise<Incident | null> {
    const query = `
      SELECT * FROM incidents
      WHERE monitor_id = $1 AND status = $2
      ORDER BY started_at DESC
      LIMIT 1;
    `;
    return this.querySingle(query, [monitorId, IncidentStatus.ONGOING]);
  }

  async resolveIncident(id: string): Promise<void> {
    const query = `
      UPDATE incidents
      SET status = $2, resolved_at = NOW()
      WHERE id = $1;
    `;
    await this.execute(query, [id, IncidentStatus.RESOLVED]);
  }

  async getIncidentsByMonitor(monitorId: string, limit: number = 20): Promise<Incident[]> {
    const query = `
      SELECT * FROM incidents
      WHERE monitor_id = $1
      ORDER BY started_at DESC
      LIMIT $2;
    `;
    return this.queryMany(query, [monitorId, limit]);
  }
}
