import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above every other statement in the file, so the
// spies they close over have to be created by vi.hoisted rather than a plain
// const — otherwise the factory runs against an uninitialised binding.
const { getUser, getClaims, single } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  single: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser, getClaims },
    from: () => ({
      select: () => ({ eq: () => ({ single }) }),
    }),
  }),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

describe('getSessionUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    single.mockResolvedValue({ data: { team_id: 't1', role: 'admin' } });
  });

  it('verifies the JWT locally via getClaims and never calls getUser', async () => {
    const { getSessionUser } = await import('../lib/server/supabase');
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u1', email: 'x@y.z' } } });

    const user = await getSessionUser();

    expect(getClaims).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
    expect(user).toMatchObject({ id: 'u1', email: 'x@y.z', teamId: 't1', role: 'admin' });
  });

  it('returns null when the token carries no subject', async () => {
    const { getSessionUser } = await import('../lib/server/supabase');
    getClaims.mockResolvedValue({ data: { claims: {} } });

    expect(await getSessionUser()).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns null when there are no claims at all', async () => {
    const { getSessionUser } = await import('../lib/server/supabase');
    getClaims.mockResolvedValue({ data: null });

    expect(await getSessionUser()).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
});
