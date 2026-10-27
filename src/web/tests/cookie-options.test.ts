import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { createServerClient, createBrowserClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createBrowserClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({ createServerClient, createBrowserClient }));
vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: () => undefined }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));

// One Secure decision, four construction sites: each must pass it.
describe.each([
  ['server client', async () => (await import('../lib/server/supabase')).supabaseServer(), createServerClient],
  ['browser client', async () => (await import('../lib/client/supabase')).supabaseBrowser(), createBrowserClient],
  [
    'auth callback',
    async () => {
      createServerClient.mockReturnValue({
        auth: { exchangeCodeForSession: async () => ({ error: null }) },
      });
      const { GET } = await import('../app/auth/callback/route');
      await GET(new NextRequest('http://localhost:3001/auth/callback?code=abc'));
    },
    createServerClient,
  ],
])('%s cookie options', (_name, call, spy) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('sets Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await call();
    expect(spy.mock.calls[0][2].cookieOptions).toEqual({ secure: true });
  });

  it('does not set Secure outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await call();
    expect(spy.mock.calls[0][2].cookieOptions).toEqual({ secure: false });
  });
});

describe('auth callback cache headers', () => {
  it('copies the cache headers Supabase supplies onto the redirect', async () => {
    vi.clearAllMocks();
    createServerClient.mockImplementation((_u, _k, opts) => ({
      auth: {
        exchangeCodeForSession: async () => {
          await opts.cookies.setAll([{ name: 'sb-a', value: 'v', options: {} }], {
            'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
            Expires: '0',
            Pragma: 'no-cache',
          });
          return { error: null };
        },
      },
    }));
    const { GET } = await import('../app/auth/callback/route');
    const res = await GET(new NextRequest('http://localhost:3001/auth/callback?code=abc'));
    expect(res.status).toBe(307);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect(res.headers.get('expires')).toBe('0');
    expect(res.cookies.get('sb-a')?.value).toBe('v');
  });
});
