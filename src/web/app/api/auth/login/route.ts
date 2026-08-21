import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/server/supabase';

/**
 * Signs a user in through Supabase Auth. The session cookies are written by the
 * Supabase server client as a side effect of a successful sign-in.
 * @param request - JSON body containing email and password
 */
export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const supabase = supabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Invalid credentials' },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('users')
      .select('team_id')
      .eq('id', data.user.id)
      .single();

    return NextResponse.json({
      success: true,
      user: { id: data.user.id, email: data.user.email, teamId: profile?.team_id ?? null },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
