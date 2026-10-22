import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { LatencyCard } from '@/components/landing/latency-card';
import { MonitorsPreview } from '@/components/landing/monitors-preview';
import { Architecture } from '@/components/landing/architecture';

export const metadata: Metadata = {
  // Resolves the relative og:image URL. Set NEXT_PUBLIC_SITE_URL before the
  // build: the value is inlined at build time, not read at runtime. When it is
  // unset Next falls back to its own detection (VERCEL_URL on Vercel, localhost
  // in development). A malformed value throws on purpose rather than silently
  // producing broken preview links.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: 'UptimeKit: know the moment it breaks',
  description:
    'Checks your endpoints every 30 seconds, keeps every response time, and messages your team in Slack or Discord the moment one goes down.',
  openGraph: {
    title: 'UptimeKit: know the moment it breaks',
    description:
      'Checks your endpoints every 30 seconds, keeps every response time, and messages your team in Slack or Discord the moment one goes down.',
  },
};

const REPO = 'https://github.com/kcotiru/UptimeKit';

// README.md "What it does", verbatim.
const CAPABILITIES = [
  ['Watches endpoints', 'Any public URL, checked as often as every 30 seconds'],
  ['Tracks speed, not just up/down', 'Median, 95th and 99th percentile response times, charted over time'],
  ['Records outages', 'Start, end, duration, and the HTTP error behind it'],
  ['Alerts your team', 'Slack, Discord, or a plain JSON webhook, fired the moment status flips'],
  ['Shares a read-only link', 'Send a graph to someone without giving them an account'],
  ['Keeps teams separate', 'Invite teammates as admin or viewer; each team sees only its own data'],
];

const DOCS = ['setup', 'operations', 'known-issues', 'design-system'];

export default function LandingPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-background text-slate-100">
      <nav className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-600/20 text-brand-400">
            <Activity className="h-5 w-5" />
          </div>
          <span className="font-bold leading-tight tracking-tight text-slate-50">UptimeKit</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-300">
          <a href={`${REPO}/blob/main/docs/setup.md`} className="hover:text-slate-50">
            Docs
          </a>
          <a href={REPO} className="hover:text-slate-50">
            GitHub
          </a>
          <Link href="/login" className="hover:text-slate-50">
            Sign in
          </Link>
        </div>
      </nav>
      <div className="grid grid-cols-1 items-center gap-10 px-4 pb-12 pt-14 lg:grid-cols-2 lg:gap-12 lg:px-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-50">
            Know the moment it breaks.
            <br />
            And how slow it was before.
          </h1>
          <p className="mt-4 max-w-md text-slate-400">
            UptimeKit checks your endpoints every 30 seconds, keeps every single response time
            rather than a rolling average, and messages your team in Slack or Discord the moment one
            goes down.
          </p>
          <p className="mt-7 flex flex-wrap items-center gap-3">
            {/*
              A "see a live monitor" link belongs here and is deliberately absent:
              the public shared view forces isUp: true so it cannot render
              downtime, its window is pinned rather than rolling, and retention
              eventually empties it. A demo link would rot.
            */}
            <a
              href={REPO}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-slate-50"
            >
              View on GitHub
            </a>
            <Link
              href="/login"
              className="rounded-lg border border-surface-border px-4 py-2 text-sm font-medium text-slate-100 hover:border-slate-400"
            >
              Sign in
            </Link>
          </p>
        </div>
        <LatencyCard />
      </div>
      <MonitorsPreview />
      <section className="border-t border-surface-border px-4 py-12 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-slate-50">What it does</h2>
        <dl className="mt-6 grid grid-cols-1 gap-x-12 gap-y-5 lg:grid-cols-2">
          {CAPABILITIES.map(([label, text]) => (
            <div key={label}>
              <dt className="text-sm font-medium text-slate-100">{label}</dt>
              <dd className="mt-0.5 text-sm text-slate-400">{text}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="border-t border-surface-border px-4 py-12 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-slate-50">How it works</h2>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          Two runnable programs, one database, no API server between them.
        </p>
        <div className="mt-6">
          <Architecture />
        </div>
      </section>
      <footer className="border-t border-surface-border px-4 py-8 text-sm text-slate-400 lg:px-8">
        <p className="flex flex-wrap gap-x-4 gap-y-2">
          <a href={REPO} className="hover:text-slate-50">
            GitHub
          </a>
          {DOCS.map((d) => (
            <a key={d} href={`${REPO}/blob/main/docs/${d}.md`} className="hover:text-slate-50">
              docs/{d}.md
            </a>
          ))}
        </p>
        <p className="mt-4">Next.js, React, Tailwind, Supabase Postgres, BullMQ and Redis.</p>
        <p className="mt-1">Built by kcotiru.</p>
      </footer>
    </main>
  );
}
