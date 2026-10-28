'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for the browser. Writes the same session cookies the server
 * client and middleware read, so a sign-in here is immediately visible to
 * Server Components on the next navigation.
 *
 * Auth calls run from the browser rather than through a Next route on purpose:
 * a server-side proxy makes every sign-in attempt arrive at Supabase from this
 * app's IP, which defeats Supabase's per-IP auth rate limiting and would let a
 * single attacker exhaust the limit for everyone. Calling directly restores it.
 *
 * The anon key is public by design; RLS is what authorizes every query.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { secure: process.env.NODE_ENV === 'production' } }
  );
}
