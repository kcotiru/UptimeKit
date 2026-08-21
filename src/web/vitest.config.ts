import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws by design outside a react-server environment.
      // Tests run in plain Node, so it resolves to a no-op here — the build
      // still enforces the boundary for real client bundles.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
      '@': path.resolve(__dirname),
    },
  },
  test: { environment: 'node', css: false },
});
