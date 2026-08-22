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
  // this costs no network call — getUser() instead validated against Supabase's
  // auth API on EVERY matched request, ~120ms of latency before anything renders.
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

  if (user && (pathname === '/login' || pathname === '/register')) {
    return redirectTo('/dashboard/monitors');
  }

  return response;
}

export const config = {
  // No /api/* entry: the only routes left under app/api are the auth ones,
  // which must stay reachable without a session. Client mutations go through
  // Server Actions, which POST to the page URL and are covered by /dashboard.
  // Adding an authenticated /api/* route means adding it here AND restoring a
  // JSON 401 branch above — a redirect to an HTML login page is wrong for JSON.
  //
  // /share/:token is deliberately absent: it is the public read path and must
  // work with no session. Its authorization is the token, enforced inside the
  // get_shared_view SQL function, not here.
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
