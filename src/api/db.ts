import { Pool } from 'pg';
import { apiConfig } from './config/api-config';

export const db = new Pool({
  connectionString: process.env.NODE_ENV === 'test' ? process.env.DATABASE_TEST_URL || apiConfig.DATABASE_URL : apiConfig.DATABASE_URL,
});
