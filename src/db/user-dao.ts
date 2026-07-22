import { Pool } from "pg";
import { User } from "../domain/models";

export class UserDao {
  constructor(private db: Pool) { }

  private mapRowToUser(row: any): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    };
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    const query = `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING *;
    `;
    const result = await this.db.query(query, [email, passwordHash]);
    return this.mapRowToUser(result.rows[0]);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const query = `
      SELECT * FROM users WHERE email = $1;
    `;
    const result = await this.db.query(query, [email]);
    if (!result.rows[0]) return null;
    return this.mapRowToUser(result.rows[0]);
  }

  async getUserById(id: string): Promise<User | null> {
    const query = `
      SELECT * FROM users WHERE id = $1;
    `;
    const result = await this.db.query(query, [id]);
    if (!result.rows[0]) return null;
    return this.mapRowToUser(result.rows[0]);
  }
}
