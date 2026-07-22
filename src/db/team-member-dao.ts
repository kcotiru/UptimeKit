import { Pool } from "pg";
import { TeamMember } from "../domain/models";

export class TeamMemberDao {
  constructor(private db: Pool) { }

  private mapRowToTeamMember(row: any): TeamMember {
    return {
      teamId: row.team_id,
      userId: row.user_id,
      role: row.role,
    };
  }

  async addMember(teamId: string, userId: string, role: string = 'member'): Promise<TeamMember> {
    const query = `
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const result = await this.db.query(query, [teamId, userId, role]);
    return this.mapRowToTeamMember(result.rows[0]);
  }

  async getMember(teamId: string, userId: string): Promise<TeamMember | null> {
    const query = `
      SELECT * FROM team_members
      WHERE team_id = $1 AND user_id = $2;
    `;
    const result = await this.db.query(query, [teamId, userId]);
    if (!result.rows[0]) return null;
    return this.mapRowToTeamMember(result.rows[0]);
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const query = `
      SELECT * FROM team_members
      WHERE team_id = $1;
    `;
    const result = await this.db.query(query, [teamId]);
    return result.rows.map((row) => this.mapRowToTeamMember(row));
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const query = `
      DELETE FROM team_members
      WHERE team_id = $1 AND user_id = $2;
    `;
    await this.db.query(query, [teamId, userId]);
  }
}
