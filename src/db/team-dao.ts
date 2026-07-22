import { Pool } from "pg";
import { Team } from "../domain/models";

export class TeamDao {
  constructor(private db: Pool) { }

  private mapRowToTeam(row: any): Team {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    };
  }

  async createTeam(name: string): Promise<Team> {
    const query = `
      INSERT INTO teams (name)
      VALUES ($1)
      RETURNING *;
    `;
    const result = await this.db.query(query, [name]);
    return this.mapRowToTeam(result.rows[0]);
  }

  async getTeamById(id: string): Promise<Team | null> {
    const query = `
      SELECT *
      FROM teams
      WHERE id = $1;
    `;
    const result = await this.db.query(query, [id]);
    if (!result.rows[0]) {
      return null;
    }
    return this.mapRowToTeam(result.rows[0]);
  }
}
