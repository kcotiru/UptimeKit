import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // tsconfig sets jsx: "preserve" for Next's own transform; the oxc transform
  // vitest uses needs its own jsx mode set explicitly here or it errors on
  // .tsx files (e.g. the dashboard page components pulled in by concurrency
  // tests).
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      // `server-only` throws by design outside a react-server environment.
      // Tests run in plain Node, so it resolves to a no-op here — the build
      // still enforces the boundary for real client bundles.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
      '@': path.resolve(__dirname),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: { environment: 'node', css: false },
});
