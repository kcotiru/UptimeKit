import { Pool } from "pg";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { AlertChannel, AlertChannelType } from "../domain/models";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = Buffer.from((process.env.ENCRYPTION_KEY || "01234567890123456789012345678901").slice(0, 32));

export class AlertChannelDao {
  constructor(private db: Pool) { }

  private encryptConfig(config: Record<string, any>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    const jsonStr = JSON.stringify(config);
    let encrypted = cipher.update(jsonStr, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return JSON.stringify({
      iv: iv.toString("hex"),
      encrypted,
      tag: authTag,
    });
  }

  private decryptConfig(encryptedData: any): Record<string, any> {
    if (typeof encryptedData === "object" && !encryptedData.encrypted) {
      return encryptedData;
    }
    const parsed = typeof encryptedData === "string" ? JSON.parse(encryptedData) : encryptedData;
    if (!parsed.iv || !parsed.encrypted || !parsed.tag) {
      return parsed;
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      ENCRYPTION_KEY,
      Buffer.from(parsed.iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "hex"));
    let decrypted = decipher.update(parsed.encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  }

  private mapRowToAlertChannel(row: any): AlertChannel {
    return {
      id: row.id,
      teamId: row.team_id,
      type: row.type as AlertChannelType,
      config: this.decryptConfig(row.config),
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
    };
  }

  async createChannel(teamId: string, type: AlertChannelType, config: Record<string, any>): Promise<AlertChannel> {
    const encryptedConfig = this.encryptConfig(config);
    const query = `
      INSERT INTO alert_channels (team_id, type, config)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const result = await this.db.query(query, [teamId, type, encryptedConfig]);
    return this.mapRowToAlertChannel(result.rows[0]);
  }

  async getChannelsByTeam(teamId: string): Promise<AlertChannel[]> {
    const query = `
      SELECT * FROM alert_channels
      WHERE team_id = $1 AND is_enabled = TRUE;
    `;
    const result = await this.db.query(query, [teamId]);
    return result.rows.map((row) => this.mapRowToAlertChannel(row));
  }

  async deleteChannel(id: string): Promise<void> {
    const query = `
      DELETE FROM alert_channels
      WHERE id = $1;
    `;
    await this.db.query(query, [id]);
  }
}
