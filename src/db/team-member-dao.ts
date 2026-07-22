import { Pool } from "pg";
import { TeamMember } from "../domain/models";
import { BaseDao } from "./base-dao";

export class TeamMemberDao extends BaseDao<TeamMember> {
  constructor(db: Pool) {
    super(db);
  }

  protected mapRow(row: any): TeamMember {
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
    return (await this.querySingle(query, [teamId, userId, role]))!;
  }

  async getMember(teamId: string, userId: string): Promise<TeamMember | null> {
    const query = `
      SELECT * FROM team_members
      WHERE team_id = $1 AND user_id = $2;
    `;
    return this.querySingle(query, [teamId, userId]);
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const query = `
      SELECT * FROM team_members
      WHERE team_id = $1;
    `;
    return this.queryMany(query, [teamId]);
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const query = `
      DELETE FROM team_members
      WHERE team_id = $1 AND user_id = $2;
    `;
    await this.execute(query, [teamId, userId]);
  }
}
