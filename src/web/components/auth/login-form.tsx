'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Activity, Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only same-origin paths. `//evil.com` and absolute URLs would make this an
  // open redirect: sign in on the real site, land on an attacker's page.
  const requested = searchParams.get('redirect');
  const redirect =
    requested && requested.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/dashboard/monitors';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Invalid credentials. Please check your details and try again.');
        setLoading(false);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error. Unable to reach authentication server.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-surface/80 backdrop-blur-xl border border-surface-border rounded-2xl shadow-2xl space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600/20 border border-brand-500/30 text-brand-500 mb-2 glow-brand">
          <Activity className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">Welcome back</h1>
        <p className="text-sm text-slate-400">Sign in to your UptimeKit team dashboard</p>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Email Address
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
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
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
          className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-lg shadow-brand-600/30 flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <span className="inline-block animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <>
              Sign In <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="text-center pt-2 border-t border-surface-border/50">
        <p className="text-xs text-slate-400">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-brand-400 font-semibold hover:underline">
            Register team
          </Link>
        </p>
      </div>
    </div>
  );
}
