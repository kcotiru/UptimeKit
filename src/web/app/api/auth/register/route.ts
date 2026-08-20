import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase';

/**
 * Registers a team owner: creates the Supabase Auth user, their team, and the
 * profile row that maps the two, then signs them in so the session cookie is set.
 * @param request - JSON body containing email, password, and optional teamName
 */
export async function POST(request: Request) {
  try {
    const { email, password, teamName } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // email_confirm skips the verification mail so local signups can log in at once.
    const { data: created, error: signUpError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (signUpError || !created.user) {
      return NextResponse.json(
        { success: false, error: signUpError?.message || 'Registration failed' },
        { status: 400 }
      );
    }

    const { data: team, error: teamError } = await admin
      .from('teams')
      .insert({ name: teamName || `${email}'s team` })
      .select('id')
      .single();

    const { error: profileError } = team
      ? await admin.from('users').insert({ id: created.user.id, team_id: team.id, email })
      : { error: null };

    if (teamError || profileError) {
      // Don't strand an auth user with no team — they could never sign in usefully.
      await admin.auth.admin.deleteUser(created.user.id);
      if (team) await admin.from('teams').delete().eq('id', team.id);
      return NextResponse.json(
        { success: false, error: (teamError || profileError)!.message },
        { status: 500 }
      );
    }

    const { error: signInError } = await supabaseServer().auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      return NextResponse.json({ success: false, error: signInError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      user: { id: created.user.id, email, teamId: team!.id },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
