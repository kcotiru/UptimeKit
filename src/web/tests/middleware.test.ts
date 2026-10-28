import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getClaims, createServerClient } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({ createServerClient }));

// What Supabase 0.10+ hands setAll as its second argument.
const CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
};

// Makes getClaims behave like a token refresh: Supabase calls the registered
// setAll with the new cookies and the cache headers before resolving.
const refreshOnClaims = () => {
  createServerClient.mockImplementation((_u, _k, opts) => ({
    auth: {
      getClaims: async () => {
        await opts.cookies.setAll([{ name: 'sb-a', value: 'v', options: {} }], CACHE_HEADERS);
        return getClaims();
      },
    },
  }));
};

const run = async (pathname: string, claims: Record<string, unknown> | null) => {
  getClaims.mockResolvedValue({ data: claims ? { claims } : null });
  const { middleware } = await import('../middleware');
  return middleware(new NextRequest(new URL(`http://localhost:3001${pathname}`)));
};

describe('middleware routing for /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // The middleware builds a CSP for every matched path except '/', and
    // buildCsp throws without a Supabase origin rather than silently emitting a
    // connect-src that would block all auth. Supplying it here, after
    // unstubAllEnvs, keeps every assertion below unchanged.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    createServerClient.mockImplementation(() => ({ auth: { getClaims } }));
  });

  it('sends a signed-in visitor from / to the dashboard', async () => {
    const res = await run('/', { sub: 'u1' });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard/monitors');
  });

  it('matches /', async () => {
    const { config } = await import('../middleware');
    expect(config.matcher).toContain('/');
  });

  it('lets a signed-out visitor see /', async () => {
    const res = await run('/', null);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still guards the dashboard while signed out', async () => {
    const res = await run('/dashboard/monitors', null);
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/login');
    expect(loc.searchParams.get('redirect')).toBe('/dashboard/monitors');
  });

  it('copies the cache headers Supabase supplies onto the response', async () => {
    refreshOnClaims();
    const res = await run('/login', null);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect(res.headers.get('expires')).toBe('0');
    expect(res.cookies.get('sb-a')?.value).toBe('v');
  });

  it('carries cache headers onto a redirect, not only cookies', async () => {
    refreshOnClaims();
    const res = await run('/dashboard/monitors', null);
    expect(res.status).toBe(307);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect(res.headers.get('expires')).toBe('0');
    expect(res.cookies.get('sb-a')?.value).toBe('v');
  });

  it('sets Secure on auth cookies in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await run('/login', null);
    expect(createServerClient.mock.calls[0][2].cookieOptions).toEqual({ secure: true });
  });

  it('does not set Secure outside production, so localhost over http can sign in', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await run('/login', null);
    expect(createServerClient.mock.calls[0][2].cookieOptions).toEqual({ secure: false });
  });
});
