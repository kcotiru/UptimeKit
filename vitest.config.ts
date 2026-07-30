import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env explicitly for tests
config({ path: '.env' });

export default defineConfig({
  test: {
    environment: 'node',
  },
});
