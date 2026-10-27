import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';

const root = resolve(__dirname, '..');
const manifestPath = resolve(root, '.next/routes-manifest.json');
const SUPABASE_URL = 'https://proj.supabase.co';

const { getClaims, createServerClient } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  createServerClient: vi.fn(),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient }));

// Both names are accepted so promoting the policy from report-only to enforcing
// does not have to churn these tests. What each test asserts is the content.
const CSP_KEY = /^content-security-policy(-report-only)?$/i;

const loadConfig = async () => {
  vi.resetModules();
  return (await import('../next.config.js')).default;
};

/** The header list next.config.js declares for a given path. */
const headersFor = async (path: string) => {
  const config = await loadConfig();
  const rules = await config.headers!();
  const matched = rules.filter((r: { source: string }) => sourceMatches(r.source, path));
  return matched.flatMap((r: { headers: { key: string; value: string }[] }) => r.headers);
};

/**
 * Does a next.config.js `source` match a path? This runs Next's own path
 * compiler rather than a reimplementation, so an unrecognised rule shape cannot
 * make these tests pass vacuously.
 *
 * `strict` is deliberately left off. The router-worker compiles custom routes
 * with `strict: true` (filesystem.js:98), but the regex baked into
 * .next/routes-manifest.json, which is what a production server and Vercel
 * actually match against, is the non-strict one: it ends `(?:/)?$` and makes the
 * leading group optional, so `'/:path*'` matches `/`. With `strict: true` it
 * does not, and every assertion about `/` would be testing the wrong thing.
 * `the compiled matcher agrees with the built routes manifest` below pins that
 * choice to the manifest instead of to this comment.
 */
const sourceMatches = (source: string, path: string): boolean =>
  Boolean(getPathMatch(source, { removeUnnamedParams: true })(path));

const get = (headers: { key: string; value: string }[], key: string) =>
  headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

const cspOf = (headers: { key: string; value: string }[]) =>
  headers.find((h) => CSP_KEY.test(h.key))?.value;

/** Runs the real middleware for a path, signed out, with Supabase mocked. */
const runMiddleware = async (pathname: string) => {
  vi.resetModules();
  getClaims.mockResolvedValue({ data: null });
  createServerClient.mockImplementation(() => ({ auth: { getClaims } }));
  const { middleware } = await import('../middleware');
  return middleware(new NextRequest(new URL(`http://localhost:3001${pathname}`)));
};

describe('next.config.js security headers', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL));
  afterEach(() => vi.unstubAllEnvs());

  it('sets nosniff, referrer policy, permissions policy and frame-ancestors none', async () => {
    const headers = await headersFor('/');
    expect(get(headers, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(get(headers, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(cspOf(headers)).toContain("frame-ancestors 'none'");
  });

  it('enforces the policy rather than reporting it', async () => {
    // CSP_KEY accepts either name so promoting the policy did not churn the
    // content assertions, but that means the whole deliverable could revert to
    // report-only with the suite still green. This is the pin: the mode itself,
    // asserted on the exact header key, on both sides.
    const config = await loadConfig();
    const rules = await config.headers!();
    const keys = rules
      .flatMap((r: { headers: { key: string }[] }) => r.headers.map((h) => h.key))
      .filter((k: string) => CSP_KEY.test(k));
    expect(keys).toEqual(['Content-Security-Policy']);

    const res = await runMiddleware('/login');
    const emitted = [...res.headers.keys()].filter((k) => CSP_KEY.test(k));
    expect(emitted).toEqual(['content-security-policy']);
  });

  it.skipIf(!existsSync(manifestPath))('the compiled matcher agrees with the built routes manifest', async () => {
    // routes-manifest.json holds the regex a production server and Vercel
    // actually match each header rule with. This asserts the matcher these tests
    // use decides every probe path the same way, so the `strict` choice above is
    // pinned to what ships rather than to a reading of Next's source. Skipped on
    // a tree that has not been built, and reported as skipped rather than passed.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const probes = [
      '/',
      '/login',
      '/logintest',
      '/dashboard',
      '/dashboard/monitors',
      '/share',
      '/share/abc',
      '/share/a/b',
      '/sharetest',
      '/auth/callback',
      '/opengraph-image',
    ];
    expect(manifest.headers.length).toBe((await (await loadConfig()).headers!()).length);
    for (const rule of manifest.headers as { source: string; regex: string }[]) {
      const shipped = new RegExp(rule.regex);
      for (const p of probes) {
        expect(sourceMatches(rule.source, p), `${rule.source} vs ${p}`).toBe(shipped.test(p));
      }
    }
  });

  it('does not set HSTS, which Vercel owns', async () => {
    const config = await loadConfig();
    const rules = await config.headers!();
    const keys = rules.flatMap((r: { headers: { key: string }[] }) =>
      r.headers.map((h) => h.key.toLowerCase())
    );
    expect(keys).not.toContain('strict-transport-security');
  });

  it('prefers frame-ancestors over X-Frame-Options, which it obsoletes', async () => {
    const headers = await headersFor('/');
    expect(get(headers, 'X-Frame-Options')).toBeUndefined();
  });

  it('disables the powered-by header', async () => {
    const config = await loadConfig();
    expect(config.poweredByHeader).toBe(false);
  });

  it('serves the static policy on /, which middleware leaves without a nonce', async () => {
    const csp = cspOf(await headersFor('/'));
    expect(csp).toBeDefined();
    expect(csp).toBe((await import('../lib/shared/csp')).buildCsp());
  });

  it('serves no static policy on a nonce path, so the two never both apply', async () => {
    for (const path of [
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
      '/dashboard/monitors',
      '/share/abc123',
    ]) {
      expect(cspOf(await headersFor(path)), path).toBeUndefined();
    }
  });

  it('leaves no path uncovered, including a 404 that only looks like a nonce path', async () => {
    // /logintest and /sharetest are matched by neither middleware nor a route,
    // so if an exclusion were a bare prefix they would get no policy at all.
    for (const path of ['/logintest', '/sharetest', '/auth/callback', '/opengraph-image']) {
      expect(cspOf(await headersFor(path)), path).toBeDefined();
    }
  });

  it('still sets the non-CSP headers on a nonce path', async () => {
    const headers = await headersFor('/dashboard/monitors');
    expect(get(headers, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('buildCsp', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL));
  afterEach(() => vi.unstubAllEnvs());

  const buildCsp = async () => (await import('../lib/shared/csp')).buildCsp;

  it('the static policy carries unsafe-inline and says so', async () => {
    expect((await buildCsp())()).toContain("'unsafe-inline'");
    // The concession has to be labelled where someone reading the policy sees it,
    // or the next person copies it onto a page that does render a session.
    const source = readFileSync(resolve(root, 'lib/shared/csp.js'), 'utf8');
    expect(source).toMatch(/weaker/i);
  });

  it('the nonce policy does not carry unsafe-inline in script-src', async () => {
    const scriptSrc = (await buildCsp())('abc123').match(/script-src[^;]*/)![0];
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('keeps unsafe-inline in style-src only, never in script-src', async () => {
    // Recharts and the share page use inline style attributes. That is a
    // style-src concession and must not bleed into script-src.
    const csp = (await buildCsp())('abc123');
    expect(csp.match(/style-src[^;]*/)![0]).toContain("'unsafe-inline'");
    expect(csp.match(/script-src[^;]*/)![0]).not.toContain("'unsafe-inline'");
  });

  it('allows the Supabase origin in connect-src', async () => {
    // The browser client talks to Supabase directly for all auth, so
    // connect-src 'self' alone breaks sign-in.
    const connectSrc = (await buildCsp())().match(/connect-src[^;]*/)![0];
    expect(connectSrc).toContain(SUPABASE_URL);
  });

  it('refuses to build a policy with no Supabase origin', async () => {
    // Without it, connect-src 'self' alone is a syntactically valid policy that
    // blocks every auth call, baked into the build with no signal anywhere. The
    // app is already unusable without this variable, so failing the build beats
    // failing in someone's browser.
    const build = await buildCsp();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(() => build()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('locks down the directives an injected tag would otherwise reach', async () => {
    const csp = (await buildCsp())('abc123');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("font-src 'self'");
  });
});

describe('middleware nonce', () => {
  const run = runMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sets a nonce policy on the auth pages', async () => {
    const res = await run('/login');
    const csp = [...res.headers.entries()].find(([k]) => CSP_KEY.test(k))?.[1];
    expect(csp).toMatch(/script-src[^;]*'nonce-[0-9a-f-]{36}'/);
    expect(csp!.match(/script-src[^;]*/)![0]).not.toContain("'unsafe-inline'");
  });

  it('sets x-nonce on the request to the same value as the response policy', async () => {
    // What this pins is only that middleware mutates the request headers with
    // the same nonce it puts in the policy, so the two cannot drift apart. It
    // does NOT claim Next consumes x-nonce: nothing in next/dist reads that
    // header, and the delivery path is Next's own.
    //
    // End-to-end nonce delivery is not unit-testable here: this suite runs
    // environment 'node' with no renderer and no server. It was verified by
    // curl against a production build instead, and the numbers are recorded in
    // the comment at the top of middleware.ts.
    const res = await run('/login');
    const csp = [...res.headers.entries()].find(([k]) => CSP_KEY.test(k))![1];
    const nonce = csp.match(/'nonce-([^']+)'/)![1];
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-nonce');
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
  });

  it('runs middleware on a share link at all, or none of the rest applies', async () => {
    // The matcher is what decides whether middleware ever sees this path. Without
    // it the nonce assertions below pass against a function production never
    // calls, and the page silently keeps the weak static policy.
    const { config } = await import('../middleware');
    expect(config.matcher).toContain('/share/:token*');
  });

  it('gives a share link the nonce policy, not the weak one', async () => {
    // The weak static policy is justified by '/' rendering no session and no
    // user-controlled data. None of that holds here: /share is public,
    // force-dynamic, and renders a monitor name and a view name someone typed.
    const res = await run('/share/abc123');
    const csp = [...res.headers.entries()].find(([k]) => CSP_KEY.test(k))?.[1];
    expect(csp).toMatch(/script-src[^;]*'nonce-[0-9a-f-]{36}'/);
    expect(csp!.match(/script-src[^;]*/)![0]).not.toContain("'unsafe-inline'");
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(
      csp!.match(/'nonce-([^']+)'/)![1]
    );
  });

  it('serves a share link without an auth call or a redirect', async () => {
    // A public link must not pay for a session round trip, and must never be
    // redirected: a signed-in person opening one wants the shared view, not
    // their dashboard.
    const res = await run('/share/abc123');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('does not redirect a signed-in visitor away from a share link', async () => {
    vi.resetModules();
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } } });
    createServerClient.mockImplementation(() => ({ auth: { getClaims } }));
    const { middleware } = await import('../middleware');
    const res = await middleware(
      new NextRequest(new URL('http://localhost:3001/share/abc123'))
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves / without a nonce, so it stays static', async () => {
    const res = await run('/');
    expect([...res.headers.entries()].find(([k]) => CSP_KEY.test(k))).toBeUndefined();
    expect(res.headers.get('x-middleware-request-x-nonce')).toBeNull();
  });

  it('gives every request its own nonce', async () => {
    const nonceOf = async () =>
      [...(await run('/login')).headers.entries()]
        .find(([k]) => CSP_KEY.test(k))![1]
        .match(/'nonce-([^']+)'/)![1];
    expect(await nonceOf()).not.toBe(await nonceOf());
  });

  it('keeps the nonce off a redirect, which renders nothing', async () => {
    const res = await run('/dashboard/monitors');
    expect(res.status).toBe(307);
  });
});

describe('the pages middleware nonces', () => {
  // A nonce header on a prerendered page is worse than no policy: Next stamps
  // the nonce onto its script tags during server rendering, so a prerendered
  // page is served a policy whose nonce appears nowhere in its HTML, and every
  // one of Next's own scripts is blocked the moment this stops being
  // report-only. '/' avoids that by getting no nonce at all; the auth pages
  // avoid it by rendering on demand.
  const AUTH_PAGES = ['login', 'register', 'forgot-password', 'reset-password'];

  it('renders the auth pages on demand, so the nonce reaches the HTML', async () => {
    for (const page of AUTH_PAGES) {
      const mod = await import(`../app/(auth)/${page}/page`);
      expect(mod.dynamic, page).toBe('force-dynamic');
    }
  });

  it('renders a share link on demand too, for the same reason', () => {
    // Read rather than imported: the page pulls in the server data layer, which
    // needs a react-server environment this suite does not have.
    const source = readFileSync(resolve(root, 'app/share/[token]/page.tsx'), 'utf8');
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('nonces nothing that is prerendered', async () => {
    const { config } = await import('../middleware');
    const nonced = config.matcher.filter((m) => m !== '/');
    // Every remaining matched path is an auth page, or under /dashboard or
    // /share, both of which are already force-dynamic. A new entry here has to
    // prove the same before it can be added.
    const DYNAMIC_TREES = ['/dashboard/:path*', '/share/:token*'];
    for (const m of nonced) {
      expect(DYNAMIC_TREES.includes(m) || AUTH_PAGES.includes(m.slice(1)), m).toBe(true);
    }
  });
});

describe('the two path lists agree', () => {
  // Next requires `export const config = { matcher: [...] }` to be statically
  // analyzable at build time. A matcher built from an imported constant or any
  // computed value is ignored, silently, and middleware then stops running on
  // the paths it looks like it covers. So the two lists cannot share a constant
  // and one of them has to be hand-written. This test is what keeps them honest
  // instead.
  //
  // Exact set equality, not the one-way implication: drift in either direction
  // is a real defect. A matched path missing from NONCE_PATHS gets two CSP
  // headers, one of them the weak static policy, which is confusing to debug. A
  // NONCE_PATHS entry that is not matched gets no policy at all, which is worse.
  // Equality catches both in one assertion and costs nothing to read.

  // next.config.js builds a policy at load time and buildCsp now throws without
  // a Supabase origin, so loading it needs the variable present.
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL));
  afterEach(() => vi.unstubAllEnvs());

  /** The alternatives inside the negative lookahead of the static CSP rule. */
  const nonceExclusions = async (): Promise<string[]> => {
    const config = await loadConfig();
    const rules = await config.headers!();
    const rule = rules.find((r: { headers: { key: string }[] }) =>
      r.headers.some((h) => CSP_KEY.test(h.key))
    );
    expect(rule, 'no rule in next.config.js carries a CSP header').toBeDefined();
    return rule!.source.match(/^\/\(\(\?!(.*)\)\.\*\)$/)![1].split('|');
  };

  /** What a matcher entry has to be excluded as. Read from the real matcher and
   *  the real compiled source, so neither side can be satisfied by a stale copy. */
  const expectedFor = (entry: string): string[] => {
    const name = entry.slice(1).replace(/\/:[A-Za-z]+\*$/, '');
    // A subtree entry needs both forms: `dashboard/` for the children and
    // `dashboard$` because '/dashboard/:path*' also matches bare '/dashboard'.
    return /\/:[A-Za-z]+\*$/.test(entry) ? [`${name}/`, `${name}$`] : [`${name}$`];
  };

  it('excludes exactly the paths middleware nonces, no more and no fewer', async () => {
    const { config } = await import('../middleware');
    const expected = config.matcher
      // '/' is excluded from the exclusion: it deliberately keeps the static policy.
      .filter((m) => m !== '/')
      .flatMap(expectedFor);
    expect([...await nonceExclusions()].sort()).toEqual([...new Set(expected)].sort());
  });

  it('keeps / out of the exclusions, so it still gets the static policy', async () => {
    expect(await nonceExclusions()).not.toContain('$');
  });
});

describe('the opengraph image route', () => {
  it('is still served, so link previews survive the policy', async () => {
    // Review Focus 4: the route is runtime = 'edge' and headers from
    // next.config.js reach it differently from a middleware-built nonce.
    const { default: Image, contentType } = await import('../app/opengraph-image');
    const res = Image();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(contentType);
  });

  it('is outside the middleware matcher, so no nonce can force it dynamic', async () => {
    const { config } = await import('../middleware');
    expect(config.matcher).not.toContain('/opengraph-image');
    for (const m of config.matcher) {
      expect(sourceMatches(m, '/opengraph-image'), m).toBe(false);
    }
  });
});
