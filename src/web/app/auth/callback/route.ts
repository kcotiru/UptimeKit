import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { safeRedirect } from '@/lib/shared/validations/redirect';

/**
 * Lands every emailed auth link: the signup confirmation and the password
 * recovery link both arrive here with a one-time `code`. Exchanging it sets the
 * session cookies, which is why this must run in a route handler rather than a
 * Server Component, because those cannot write cookies.
 *
 * Deliberately outside the middleware matcher: the visitor has no session yet,
 * and the guard would bounce them to /login before the code was ever redeemed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeRedirect(searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', origin));
  }

  const response = NextResponse.redirect(new URL(next, origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
      cookies: {
        getAll: () => request.cookies.getAll(),
        // headers carries Cache-Control: no-store, so a CDN never caches a
        // redirect bearing the fresh session's Set-Cookie.
        setAll: (list, headers) => {
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Expired, already used, or issued for a different browser. All three are
    // the same to the visitor: ask for a fresh link.
    // Deliberately a fresh response: a failed exchange sets no session cookie,
    // so this redirect carries no Set-Cookie and needs no cache headers.
    return NextResponse.redirect(new URL('/login?error=invalid_link', origin));
  }

  return response;
}
