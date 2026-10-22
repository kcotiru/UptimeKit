import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}));

const run = async (pathname: string, claims: Record<string, unknown> | null) => {
  getClaims.mockResolvedValue({ data: claims ? { claims } : null });
  const { middleware } = await import('../middleware');
  return middleware(new NextRequest(new URL(`http://localhost:3001${pathname}`)));
};

describe('middleware routing for /', () => {
  beforeEach(() => vi.clearAllMocks());

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
});
