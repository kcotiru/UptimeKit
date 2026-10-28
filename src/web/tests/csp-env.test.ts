import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const { buildCsp } = createRequire(import.meta.url)('../lib/shared/csp.js') as {
  buildCsp: (nonce?: string) => string;
};

const scriptSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('script-src '))!;

describe('script-src and unsafe-eval', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['nonce variant', 'abc'],
    ['static variant', undefined],
  ])('production %s never allows eval', (_n, nonce) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('NODE_ENV', 'production');
    expect(scriptSrc(buildCsp(nonce))).not.toContain("'unsafe-eval'");
  });

  it.each([
    ['nonce variant', 'abc'],
    ['static variant', undefined],
  ])('development %s allows eval, for webpack dev source maps and React Refresh', (_n, nonce) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('NODE_ENV', 'development');
    expect(scriptSrc(buildCsp(nonce))).toContain("'unsafe-eval'");
  });

  it('never adds unsafe-inline to the nonce variant in either mode', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    for (const env of ['production', 'development']) {
      vi.stubEnv('NODE_ENV', env);
      expect(scriptSrc(buildCsp('abc'))).not.toContain("'unsafe-inline'");
    }
  });
});
