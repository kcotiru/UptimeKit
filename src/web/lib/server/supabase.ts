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
 * Service-role client. Bypasses row level security — only for signup, where the
 * team row has to exist before the user has a session. Never expose to the browser.
 */
export function supabaseAdmin() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Session-free client using the public anon key. For pages served to visitors
 * with no account — currently only /share/[token], where authorization is the
 * token itself, checked inside get_shared_view. Carries no elevated privilege:
 * every RLS policy still applies, which is exactly why the share path needs a
 * SECURITY DEFINER function rather than a direct table read. Do not confuse
 * this with supabaseAdmin(), which uses the service-role key and bypasses RLS.
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
    .select('team_id')
    .eq('id', data.user.id)
    .single();

  return {
    id: data.user.id,
    email: data.user.email ?? '',
    teamId: profile?.team_id ?? '',
  };
}
