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
  },
});
