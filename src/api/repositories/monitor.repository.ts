import { db } from '../db';
import { randomUUID } from 'crypto';

export interface Monitor {
  id: string;
  team_id: string;
  name: string;
  url: string;
  http_method: string;
  expected_status: number;
  check_interval: number;
  status: string;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

export type CreateMonitorDTO = Omit<Monitor, 'id' | 'team_id' | 'status' | 'is_deleted' | 'created_at' | 'updated_at'>;
export type UpdateMonitorDTO = Partial<CreateMonitorDTO>;

export class MonitorRepository {
  private static async withTenant<T>(teamId: string, fn: (client: any) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_team_id', $1, true)", [teamId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async create(teamId: string, data: CreateMonitorDTO): Promise<Monitor> {
    return this.withTenant(teamId, async (client) => {
      const { name, url, http_method, expected_status, check_interval } = data;
      const id = randomUUID();
      const res = await client.query(
        `INSERT INTO monitors (id, team_id, name, url, http_method, expected_status, check_interval)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, teamId, name, url, http_method, expected_status, check_interval]
      );
      return res.rows[0];
    });
  }

  static async findById(teamId: string, id: string): Promise<Monitor | null> {
    return this.withTenant(teamId, async (client) => {
      const res = await client.query(
        `SELECT * FROM monitors WHERE id = $1 AND team_id = $2 AND is_deleted = false`,
        [id, teamId]
      );
      return res.rows[0] || null;
    });
  }

  static async findAll(teamId: string, cursor?: string, limit: number = 50): Promise<Monitor[]> {
    return this.withTenant(teamId, async (client) => {
      let query = `SELECT * FROM monitors WHERE team_id = $1 AND is_deleted = false`;
      const params: any[] = [teamId];
      
      if (cursor) {
        query += ` AND id < $2`;
        params.push(cursor);
      }
      
      query += ` ORDER BY id DESC LIMIT $${params.length + 1}`;
      params.push(limit);
      
      const res = await client.query(query, params);
      return res.rows;
    });
  }

  static async update(teamId: string, id: string, data: UpdateMonitorDTO): Promise<Monitor | null> {
    return this.withTenant(teamId, async (client) => {
      const updates: string[] = [];
      const params: any[] = [id, teamId];
      let paramCount = 3;
      
      if (data.name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        params.push(data.name);
      }
      if (data.url !== undefined) {
        updates.push(`url = $${paramCount++}`);
        params.push(data.url);
      }
      if (data.http_method !== undefined) {
        updates.push(`http_method = $${paramCount++}`);
        params.push(data.http_method);
      }
      if (data.expected_status !== undefined) {
        updates.push(`expected_status = $${paramCount++}`);
        params.push(data.expected_status);
      }
      if (data.check_interval !== undefined) {
        updates.push(`check_interval = $${paramCount++}`);
        params.push(data.check_interval);
      }
      if (data.status !== undefined) {
        updates.push(`status = $${paramCount++}`);
        params.push(data.status);
      }
      
      if (updates.length === 0) {
        const res = await client.query(`SELECT * FROM monitors WHERE id = $1 AND team_id = $2 AND is_deleted = false`, [id, teamId]);
        return res.rows[0] || null;
      }
      
      updates.push(`updated_at = NOW()`);
      
      const query = `
        UPDATE monitors 
        SET ${updates.join(', ')} 
        WHERE id = $1 AND team_id = $2 AND is_deleted = false
        RETURNING *
      `;
      
      const res = await client.query(query, params);
      return res.rows[0] || null;
    });
  }

  static async delete(teamId: string, id: string): Promise<boolean> {
    return this.withTenant(teamId, async (client) => {
      const res = await client.query(
        `UPDATE monitors 
         SET is_deleted = true, deleted_at = NOW() 
         WHERE id = $1 AND team_id = $2 AND is_deleted = false
         RETURNING id`,
        [id, teamId]
      );
      return res.rowCount !== null && res.rowCount > 0;
    });
  }
}
