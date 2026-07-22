import { Pool } from "pg";
import { Team } from "../domain/models";
import { BaseDao } from "./base-dao";

export class TeamDao extends BaseDao<Team> {
  constructor(db: Pool) {
    super(db);
  }

  protected mapRow(row: any): Team {
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
    return (await this.querySingle(query, [name]))!;
  }

  async getTeamById(id: string): Promise<Team | null> {
    const query = `
      SELECT *
      FROM teams
      WHERE id = $1;
    `;
    return this.querySingle(query, [id]);
  }
}
