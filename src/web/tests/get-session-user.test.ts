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

// React only exports `cache` from the "react-server" condition subset
// (react.shared-subset.js) — plain Node/vitest resolves the default `react`
// entrypoint, which has no `cache` export at all. This stub lets the module
// under test load and lets us prove the *wiring* (getSessionUser is wrapped
// in cache()), but it cannot prove React's real per-request dedup semantics
// — see the "memoizes" test below and the report for the honest limit.
vi.mock('react', () => ({
  cache: (fn: (...args: unknown[]) => unknown) => {
    let called = false;
    let result: unknown;
    return (...args: unknown[]) => {
      if (!called) {
        called = true;
        result = fn(...args);
      }
      return result;
    };
  },
}));

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

  // This proves getSessionUser is wired through cache() — not that React's
  // real per-request cache dedupes, which vitest cannot exercise (see the
  // stub note above; the real cache() lives in the react-server condition
  // subset that plain Node/vitest does not resolve).
  it('is wrapped in cache() so a second call does not re-invoke getClaims', async () => {
    const { getSessionUser } = await import('../lib/server/supabase');
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u1', email: 'x@y.z' } } });

    await getSessionUser();
    await getSessionUser();

    expect(getClaims).toHaveBeenCalledOnce();
  });
});
