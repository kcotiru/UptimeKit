import { Pool } from "pg";
import dotenv from 'dotenv';

dotenv.config();

export const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

export const testDbConnection = async () => {
  try {
    const res = await dbPool.query('SELECT NOW()');
    console.log('[✅] Database connected successfully at:', res.rows[0].now);
  } catch (error) {
    console.error('[❌] Database connection failed:', error);
    process.exit(1);
  }
};
