'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Activity, Lock, Mail, Users, AlertCircle, ArrowRight, MailCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { passwordError } from '@/lib/shared/password';

type Invite = { team_name: string; invite_role: string };

export function RegisterForm() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // null = no invite in the URL, or we haven't looked yet; false = looked and
  // the token is dead. describe_invite returns zero rows for unknown, revoked
  // and expired alike, so those three are indistinguishable here by design.
  const [invite, setInvite] = useState<Invite | false | null>(null);

  useEffect(() => {
    if (!inviteToken) return;

    let cancelled = false;
    supabaseBrowser()
      .rpc('describe_invite', { p_token: inviteToken })
      .then(({ data }) => {
        if (!cancelled) setInvite((data as Invite[] | null)?.[0] ?? false);
      });

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const joining = invite !== null && invite !== false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }
    const tooShort = passwordError(password);
    if (tooShort) {
      setError(tooShort);
      return;
    }

    setLoading(true);

    try {
      // Only team_name and invite_token are read by handle_new_user(); the
      // trigger takes the role from the invite row, never from here. See the
      // TRUST BOUNDARY note above the function in supabase/schema.sql.
      const { error: signUpError } = await supabaseBrowser().auth.signUp({
        email,
        password,
        options: {
          data: joining ? { invite_token: inviteToken } : { team_name: teamName },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard/monitors`,
        },
      });

      if (signUpError) {
        // Provider text is dropped: this runs in the browser, so there is nowhere to log it.
        setError('Registration failed. Check your details and try again.');
        setLoading(false);
        return;
      }

      // No redirect to the dashboard: with email confirmation on, signUp returns
      // no session until the address is verified.
      setSent(true);
    } catch {
      setError('Could not reach the server. Try again.');
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="w-full max-w-md p-8 bg-surface border border-surface-border rounded-lg space-y-6 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-400">
          <MailCheck className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-50">Check your inbox</h1>
          <p className="text-sm text-slate-400">
            We sent a confirmation link to <span className="text-slate-200">{email}</span>. Open it
            to activate your account, then sign in.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Nothing after a minute or two? Check spam, or{' '}
          <Link href="/register" className="text-brand-400 font-semibold hover:underline">
            try again
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-surface border border-surface-border rounded-lg space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-400 mb-2">
          <Activity className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">
          {joining ? 'Join the team' : 'Create account'}
        </h1>
        <p className="text-sm text-slate-400">
          {joining ? (
            <>
              You&apos;re joining{' '}
              <span className="font-semibold text-slate-200">{(invite as Invite).team_name}</span> as
              a {(invite as Invite).invite_role}
            </>
          ) : (
            'Create a team and start watching endpoints.'
          )}
        </p>
      </div>

      {invite === false && (
        <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-400 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>
            That invite link is no longer valid. It may have expired or been revoked. Ask for a new
            one, or register your own team below.
          </span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {!joining && (
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Team name
            </label>
            <div className="relative">
              <Users className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Acme Engineering"
                className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@acme.com"
              required
              className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <span className="inline-block animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <>
              {joining ? 'Join team' : 'Create account'} <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="text-center pt-2 border-t border-surface-border/50">
        <p className="text-xs text-slate-400">
          Already have a team account?{' '}
          <Link href="/login" className="text-brand-400 font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
