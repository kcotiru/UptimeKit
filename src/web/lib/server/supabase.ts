import 'server-only';
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

/** Current user plus their team, or null when unauthenticated. */
export async function getSessionUser() {
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('team_id, role')
    .eq('id', data.user.id)
    .single();

  return {
    id: data.user.id,
    email: data.user.email ?? '',
    teamId: profile?.team_id ?? '',
    // Read from the profile row, never from the JWT: app_metadata would need
    // re-issuing on every role change, and user_metadata is client-writable.
    role: profile?.role ?? 'viewer',
  };
}
