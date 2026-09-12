'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, Lock, AlertCircle, ArrowRight } from 'lucide-react';
import { supabaseBrowser } from '@/lib/client/supabase';

export function ResetPasswordForm() {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Supabase enforces its own minimum server-side; this is just the instant
    // feedback, and the mismatch check it cannot do for us.
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setLoading(true);

    // Authorized by the recovery session the callback route just established —
    // no current password needed, and no token handled here.
    const { error: updateError } = await supabaseBrowser().auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message || 'Could not update the password. Request a fresh link.');
      setLoading(false);
      return;
    }

    // Sign out so the new password is actually exercised on the way back in,
    // and so a shared or borrowed machine is not left holding a live session.
    await supabaseBrowser().auth.signOut();
    router.push('/login?reset=1');
  };

  return (
    <div className="w-full max-w-md p-8 bg-surface/80 backdrop-blur-xl border border-surface-border rounded-lg space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-500 mb-2">
          <Activity className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">Choose a new password</h1>
        <p className="text-sm text-slate-400">You&apos;ll sign in with it straight after</p>
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
            New password
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

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Confirm password
          </label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••••••"
              required
              className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <span className="inline-block animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <>
              Update password <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="text-center pt-2 border-t border-surface-border/50">
        <p className="text-xs text-slate-400">
          Link expired?{' '}
          <Link href="/forgot-password" className="text-brand-400 font-semibold hover:underline">
            Request another
          </Link>
        </p>
      </div>
    </div>
  );
}
