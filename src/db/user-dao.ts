import { Pool } from "pg";
import { User } from "../domain/models";
import { BaseDao } from "./base-dao";

export class UserDao extends BaseDao<User> {
  constructor(db: Pool) {
    super(db);
  }

  protected mapRow(row: any): User {
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
    return (await this.querySingle(query, [email, passwordHash]))!;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const query = `
      SELECT * FROM users WHERE email = $1;
    `;
    return this.querySingle(query, [email]);
  }

  async getUserById(id: string): Promise<User | null> {
    const query = `
      SELECT * FROM users WHERE id = $1;
    `;
    return this.querySingle(query, [id]);
  }
}
