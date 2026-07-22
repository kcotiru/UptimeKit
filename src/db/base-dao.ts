import { Pool, QueryResult } from "pg";

export abstract class BaseDao<T> {
  constructor(protected db: Pool) {}

  protected abstract mapRow(row: any): T;

  protected async querySingle(query: string, values?: any[]): Promise<T | null> {
    const result = await this.db.query(query, values);
    if (!result.rows[0]) return null;
    return this.mapRow(result.rows[0]);
  }

  protected async queryMany(query: string, values?: any[]): Promise<T[]> {
    const result = await this.db.query(query, values);
    return result.rows.map((row) => this.mapRow(row));
  }

  protected async execute(query: string, values?: any[]): Promise<QueryResult> {
    return this.db.query(query, values);
  }
}
