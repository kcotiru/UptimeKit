import runner from 'node-pg-migrate';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

/**
 * Runs database migrations in specified direction.
 * @param direction 'up' or 'down'
 * @param databaseUrl Optional connection URL override
 */
export async function runMigrations(direction: 'up' | 'down' = 'up', databaseUrl?: string): Promise<void> {
  const dbUrl = databaseUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const migrationsDir = direction === 'up'
    ? path.join(__dirname, '../migrations')
    : path.join(__dirname, '../migrations/down');

  await runner({
    databaseUrl: dbUrl,
    dir: migrationsDir,
    direction,
    migrationsTable: 'pgmigrations',
    verbose: true,
  });
}

if (require.main === module) {
  const direction = (process.argv[2] === 'down' ? 'down' : 'up') as 'up' | 'down';
  runMigrations(direction)
    .then(() => {
      console.log(`Migrations (${direction}) completed successfully.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
