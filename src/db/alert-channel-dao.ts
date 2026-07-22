import { Pool } from "pg";
import { encryptConfig, decryptConfig } from "../utils/crypto";
import { AlertChannel, AlertChannelType } from "../domain/models";
import { BaseDao } from "./base-dao";

export class AlertChannelDao extends BaseDao<AlertChannel> {
  constructor(db: Pool) {
    super(db);
  }

  protected mapRow(row: any): AlertChannel {
    return {
      id: row.id,
      teamId: row.team_id,
      type: row.type as AlertChannelType,
      config: decryptConfig(row.config),
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
    };
  }

  async createChannel(channel: Omit<AlertChannel, 'id' | 'createdAt'>): Promise<AlertChannel> {
    const encryptedConfig = encryptConfig(channel.config);
    const query = `
      INSERT INTO alert_channels (team_id, type, config)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    return (await this.querySingle(query, [channel.teamId, channel.type, encryptedConfig]))!;
  }

  async getChannelsByTeam(teamId: string): Promise<AlertChannel[]> {
    const query = `
      SELECT * FROM alert_channels
      WHERE team_id = $1 AND is_enabled = TRUE;
    `;
    return this.queryMany(query, [teamId]);
  }

  async deleteChannel(id: string): Promise<void> {
    const query = `
      DELETE FROM alert_channels
      WHERE id = $1;
    `;
    await this.execute(query, [id]);
  }
}
