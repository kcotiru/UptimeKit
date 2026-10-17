import 'server-only';
import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Supabase client bound to the request's session cookies. Queries run as the
 * logged-in user, so row level security enforces team isolation.
 */
export function supabaseServer() {
  const store = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Components cannot set cookies; middleware refreshes the session.
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* noop */
        }
      },
    },
  });
}

/**
 * Session-free client using the public anon key. For pages served to visitors
 * with no account — currently only /share/[token], where authorization is the
 * token itself, checked inside get_shared_view. Carries no elevated privilege:
 * every RLS policy still applies, which is exactly why the share path needs a
 * SECURITY DEFINER function rather than a direct table read.
 *
 * There is deliberately no service-role client anywhere in this app. Signup used
 * to need one to create the team before the user had a session; the
 * handle_new_user() trigger does that inside the database now, so the
 * RLS-bypassing key never reaches a request path.
 */
export function supabaseAnon() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Signed-in user's id and email from the session token, or null when
 * unauthenticated. This is the free part of the session: getClaims() verifies
 * the JWT locally against the project's JWKS, with no network call.
 *
 * The dashboard layout renders on every route and needs only the email, so
 * paying getSessionUser()'s profile round trip there buys nothing. Use
 * getSessionUser() whenever teamId or role is needed — and `role` must always
 * come from the database row, never from the token.
 */
export const getSessionClaims = cache(async () => {
  const { data } = await supabaseServer().auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
  };
});

/**
 * Current user plus their team, or null when unauthenticated.
 *
 * Uses getClaims() rather than getUser(): getClaims() verifies the JWT
 * signature locally against the project's JWKS, so — like middleware.ts —
 * this costs no network round trip to Supabase's auth API, unlike getUser()
 * (~120ms). Trade-off: a session revoked mid-token-lifetime stays valid here
 * until the token expires. That window grants no data a valid token would
 * not already reach, because row level security authorizes every query —
 * and the role that gates admin actions is read from the database row, not
 * the token, so a downgraded role takes effect immediately.
 *
 * Wrapped in React's cache() so repeated calls within one request (layout,
 * then a page's own canInvite check) dedupe to a single round trip. cache()
 * dedupes only within a request, so there is no cross-request staleness risk.
 */
export const getSessionUser = cache(async () => {
  const claims = await getSessionClaims();
  if (!claims) return null;

  const { data: profile } = await supabaseServer()
    .from('users')
    .select('team_id, role')
    .eq('id', claims.id)
    .single();

  return {
    ...claims,
    teamId: profile?.team_id ?? '',
    // Read from the profile row, never from the JWT: app_metadata would need
    // re-issuing on every role change, and user_metadata is client-writable.
    role: profile?.role ?? 'viewer',
  };
});
