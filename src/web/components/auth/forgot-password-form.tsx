'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity, Mail, AlertCircle, ArrowRight, MailCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/client/supabase';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);

    // ponytail: Supabase's built-in sender, capped at a few messages an hour and
    // limited to project members. Switching to real delivery is SMTP config in
    // the Supabase dashboard — no change here.
    const { error: resetError } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    // Deliberately not surfaced per-address: telling the visitor whether the
    // mail went out turns this form into a "does this account exist" oracle.
    // Only a transport failure is worth showing.
    if (resetError && resetError.status !== 400) {
      setError('Could not send the reset link right now. Please try again shortly.');
      setLoading(false);
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <div className="w-full max-w-md p-8 bg-surface/80 backdrop-blur-xl border border-surface-border rounded-lg space-y-6 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-500">
          <MailCheck className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-50">Check your inbox</h1>
          <p className="text-sm text-slate-400">
            If an account exists for <span className="text-slate-200">{email}</span>, a password
            reset link is on its way. The link is single-use and expires.
          </p>
        </div>
        <Link href="/login" className="inline-block text-xs text-brand-400 font-semibold hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-surface/80 backdrop-blur-xl border border-surface-border rounded-lg space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-500 mb-2">
          <Activity className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">Reset your password</h1>
        <p className="text-sm text-slate-400">
          We&apos;ll email you a link to choose a new one
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <span className="inline-block animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <>
              Send reset link <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="text-center pt-2 border-t border-surface-border/50">
        <p className="text-xs text-slate-400">
          Remembered it?{' '}
          <Link href="/login" className="text-brand-400 font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
