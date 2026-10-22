import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session on every matched request and guards
 * /dashboard/* behind a valid session.
 * @param request - Incoming NextRequest object
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
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

  // Carry any refreshed session cookies onto the redirect, or they're lost.
  const redirectTo = (path: string, search?: Record<string, string>) => {
    const url = new URL(path, request.url);
    Object.entries(search ?? {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
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
  // /share/:token is deliberately absent: it is the public read path and must
  // work with no session. Its authorization is the token, enforced inside the
  // get_shared_view SQL function, not here.
  // ponytail: '/' now runs getClaims() on every public hit, so a deploy missing
  // NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY fails on the
  // landing page too, not only in the app. Left unguarded because the rest of
  // the app is already unusable without them; upgrade path: skip the Supabase
  // client for '/' when those vars are absent.
  matcher: ['/', '/dashboard/:path*', '/login', '/register', '/forgot-password', '/reset-password'],
};
