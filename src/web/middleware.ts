import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/shared/csp';

/**
 * Refreshes the Supabase session on every matched request and guards
 * /dashboard/* behind a valid session.
 * @param request - Incoming NextRequest object
 */
export async function middleware(request: NextRequest) {
  // A nonce CSP requires dynamic rendering: a prerendered page has no request
  // to derive a nonce from, so its HTML would be served under a policy whose
  // nonce appears nowhere in it and every one of Next's own scripts would be
  // blocked. So '/' is deliberately left out and keeps the weaker static policy
  // from next.config.js instead. The /dashboard routes and /share/:token are
  // already force-dynamic, so a nonce costs them nothing, and the auth pages
  // were made dynamic for it on purpose: they handle passwords and should not
  // take the weaker policy.
  //
  // How the nonce reaches the script tags is Next's business, not ours, and the
  // exact path is deliberately not described here: setting x-nonce is not known
  // to be what Next consumes, and a guess written down beside working code is
  // how the next person refactors it into breakage. What IS verified, by curl
  // against a production build served with `next start`: /login returns 200
  // with 14 script tags and 15 nonce attributes whose value is byte-identical
  // to the response header's nonce; /share/<token> returns 404 with 11 scripts
  // and 12 nonced; /share/a/b, which matches no route, 404 with 10 scripts and
  // 11 nonced; and '/' returns 200 with 12 scripts and 0 nonce attributes under
  // script-src 'self' 'unsafe-inline', which is the intended static policy.
  // Re-run that check before changing anything here.
  const nonce = request.nextUrl.pathname === '/' ? null : crypto.randomUUID();
  if (nonce) request.headers.set('x-nonce', nonce);

  // /share/:token is here for the nonce and nothing else. The weak static
  // policy is justified by '/' rendering no session and no user-controlled
  // data; a shared view renders a monitor name and a view name someone typed,
  // so it is the one public page where the difference bites. It returns before
  // the Supabase client exists, so a public link pays for no auth round trip,
  // and before any redirect rule, so a signed-in visitor opening a shared link
  // sees the shared view rather than their own dashboard. Its authorization is
  // still the token, enforced inside get_shared_view, never here.
  // Bare /share is a 404 and carries no token, but '/share/:token*' matches it,
  // so it is handled here too rather than falling through to the session work.
  if (/^\/share(\/|$)/.test(request.nextUrl.pathname)) {
    const shared = NextResponse.next({ request });
    shared.headers.set('Content-Security-Policy', buildCsp(nonce!));
    return shared;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        // headers carries Cache-Control: no-store, so a CDN never caches a
        // response bearing Set-Cookie. Defence in depth: Vercel already skips those.
        setAll: (list, headers) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
      // httpOnly stays false (the browser client reads the refresh token) and
      // maxAge stays at Supabase's 400 day default. Secure only in production,
      // or localhost over http could not store the cookie.
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
    }
  );

  // getClaims() verifies the JWT locally against the project's JWKS (ES256), so
  // this costs no network call (getUser() instead validated against Supabase's
  // auth API on EVERY matched request, ~120ms of latency before anything renders).
  // It still refreshes an expired token, because it reads the session first.
  //
  // Trade-off: a session revoked mid-token-lifetime stays valid here until the
  // token expires. Row level security still authorizes every query, so that
  // window grants no data a valid token would not already reach.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  const { pathname } = request.nextUrl;

  // Carry any refreshed session cookies and their cache headers onto the
  // redirect, or they're lost.
  const redirectTo = (path: string, search?: Record<string, string>) => {
    const url = new URL(path, request.url);
    Object.entries(search ?? {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    ['cache-control', 'expires', 'pragma'].forEach((h) => {
      const v = response.headers.get(h);
      if (v) redirect.headers.set(h, v);
    });
    return redirect;
  };

  if (!user && pathname.startsWith('/dashboard')) {
    return redirectTo('/login', { redirect: pathname });
  }

  // /reset-password runs on the recovery session the emailed link established,
  // so it needs a session like /dashboard does, but landing on /login would
  // strand someone who cannot log in, which is the whole reason they are here.
  if (!user && pathname === '/reset-password') {
    return redirectTo('/forgot-password');
  }

  // /reset-password is deliberately absent: a signed-in user reaching it has a
  // live recovery session and is there on purpose. Bouncing them to the
  // dashboard would make the emailed link unusable.
  if (user && (pathname === '/' || pathname === '/login' || pathname === '/register')) {
    return redirectTo('/dashboard/monitors');
  }

  // Only on the response that actually renders. A redirect has no body, so
  // there is nothing on it for a policy to govern. Enforcing after a clean
  // browser pass; it shipped report-only until that pass.
  if (nonce) response.headers.set('Content-Security-Policy', buildCsp(nonce));

  return response;
}

export const config = {
  // There is no app/api tree any more: sign-in, sign-up and sign-out call
  // Supabase from the browser, and every mutation goes through a Server Action,
  // which POSTs to the page URL and is covered by /dashboard. Adding an
  // authenticated /api/* route means adding it here AND restoring a JSON 401
  // branch above, since a redirect to an HTML login page is wrong for JSON.
  //
  // /auth/callback is deliberately absent: it redeems the emailed confirmation
  // and recovery codes, so it runs before a session exists and the guard above
  // would bounce it to /login before the code was ever exchanged.
  //
  // /share/:token is matched for one reason only: to give a public page the
  // nonce CSP instead of the weaker static one, since it renders names a user
  // typed. The handler above returns before any session work, so this path
  // still needs no session and is still authorized by the token alone, inside
  // the get_shared_view SQL function rather than here.
  // ponytail: '/' now runs getClaims() on every public hit, so a deploy missing
  // NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY fails on the
  // landing page too, not only in the app. Left unguarded because the rest of
  // the app is already unusable without them; upgrade path: skip the Supabase
  // client for '/' when those vars are absent.
  // Do NOT refactor this into an imported or computed value. Next requires the
  // matcher to be statically analyzable at build time; anything it cannot read
  // literally is ignored silently, and middleware then stops running on these
  // paths with no error anywhere. That is why NONCE_PATHS in next.config.js
  // mirrors this list by hand instead of sharing a constant with it, and why
  // tests/headers.test.ts asserts the two agree exactly.
  matcher: [
    '/',
    '/dashboard/:path*',
    '/share/:token*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ],
};
