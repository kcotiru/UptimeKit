import { defineConfig, defaultExclude } from 'vitest/config';
import { config } from 'dotenv';

// Load .env explicitly for tests
config({ path: '.env' });

export default defineConfig({
  test: {
    environment: 'node',
    // src/web has its own vitest.config.ts (with a server-only stub alias) and
    // its own `npm test`. Without this, the root run sweeps up src/web/tests/*
    // too, and those files fail to collect for lack of that alias.
    exclude: [...defaultExclude, 'src/web/**'],
    // Several integration test files call applySchema() against the same local
    // test database. schema.sql runs as one multi-statement query per call, and
    // two of those queries running concurrently in separate worker processes can
    // deadlock on Postgres system catalogs (pg_proc) while each redefines the
    // same functions. The suite is small and fast enough that serial file
    // execution costs nothing worth trading for the intermittent failure.
    fileParallelism: false,
  },
});
