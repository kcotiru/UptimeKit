import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import LandingPage, { metadata } from '../app/page';

const root = resolve(__dirname, '..');
const render = () => renderToStaticMarkup(createElement(LandingPage));
const landingFiles = () =>
  readdirSync(resolve(root, 'components/landing'))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `components/landing/${f}`);

describe('landing page', () => {
  it('renders a page instead of redirecting', () => {
    const html = render();
    expect(html.length).toBeGreaterThan(300);
    expect(html).toContain('Know the moment it breaks');
  });

  it('renders nothing that needs a session', () => {
    // status-badge is shared with the dashboard's client tree: a 'use client' there would leak into `/`.
    const files = ['app/page.tsx', 'components/monitors/status-badge.tsx', ...landingFiles()];
    expect(landingFiles().length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(resolve(root, f), 'utf8'), f).not.toMatch(
        /['"]use client['"]|cookies\(|supabaseServer|getSession(Claims|User)/
      );
    }
  });
});

describe('landing hero and product shot', () => {
  it('uses the hero copy the owner fixed', () => {
    const html = render();
    expect(html).toContain('Know the moment it breaks');
    expect(html).toContain('And how slow it was before');
    expect(html).toContain('checks your endpoints every 30 seconds');
  });

  it('links to the source', () => {
    // Bare repo links only (the docs links end in a path): nav, hero button, footer.
    expect(render().match(/href="https:\/\/github\.com\/kcotiru\/UptimeKit"/g)).toHaveLength(3);
  });

  // The negative lookahead counts unmodified fills only: the nav's brand tile is
  // bg-brand-600/20, an opacity-modified surface, not a button.
  it('fills exactly one button with the brand colour', () => {
    expect(render().match(/bg-brand-(500|600)(?!\/)/g) ?? []).toHaveLength(1);
  });

  it('stacks to one column before the breakpoint', () => {
    // `items-center` is on the hero grid only, so the capabilities <dl> cannot satisfy this.
    expect(render()).toMatch(/grid-cols-1 items-center[^"]*\b(sm|md|lg):grid-cols-2/);
  });

  // `fill-surface-alarm` is the band only. Plain `surface-alarm` would also be
  // satisfied by the down row's `bg-surface-alarm`, so the band could lose its
  // token without this failing.
  it('draws the outage band with the alarm token', () => {
    expect(render()).toContain('fill-surface-alarm');
  });

  // The status tones, not the words: the hero paragraph ends "goes down", so
  // asserting on the word alone passes with no down row on the page at all.
  it('shows a down row and a degraded row', () => {
    const html = render();
    expect(html).toContain('text-status-down');
    expect(html).toContain('text-status-degraded');
  });

  it('contains no em dash', () => {
    expect(render()).not.toContain('\u2014');
  });

  it('uses no green for a healthy row', () => {
    expect(render()).not.toMatch(/(text|bg|stroke|fill|border)-(green|emerald)-/);
  });
});

describe('landing capabilities, architecture and footer', () => {
  it('lists the capabilities from the README', () => {
    const html = render();
    for (const label of [
      'Watches endpoints',
      'Tracks speed, not just up/down',
      'Records outages',
      'Alerts your team',
      'Shares a read-only link',
      'Keeps teams separate',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('shows all three storage tiers', () => {
    const html = render();
    for (const t of ['Raw checks', 'Hourly rollups', 'Daily rollups']) expect(html).toContain(t);
  });

  it('draws the architecture with an accessible name', () => {
    const html = render();
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*>\s*<title>[^<]*row level security/);
  });

  it('footer links to the docs', () => {
    const html = render();
    for (const d of ['setup', 'operations', 'known-issues', 'design-system'])
      expect(html).toContain(`github.com/kcotiru/UptimeKit/blob/main/docs/${d}.md`);
  });

  it('footer doc links point at files that exist', () => {
    for (const d of ['setup', 'operations', 'known-issues', 'design-system'])
      expect(existsSync(resolve(root, `../../docs/${d}.md`)), d).toBe(true);
  });
});

describe('landing metadata', () => {
  it('describes itself for a pasted link', () => {
    expect(String(metadata.title)).toContain('UptimeKit');
    expect(metadata.description).toBeTruthy();
    expect(metadata.openGraph?.title).toBeTruthy();
  });

  it('resolves metadataBase from NEXT_PUBLIC_SITE_URL', async () => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://status.example.com';
    try {
      vi.resetModules();
      const { metadata: fresh } = await import('../app/page');
      expect(String(fresh.metadataBase)).toBe('https://status.example.com/');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = prev;
      vi.resetModules();
    }
  });

  it('keeps the metadata free of em dashes', () => {
    expect(String(metadata.title)).not.toContain('\u2014');
    expect(metadata.description ?? '').not.toContain('\u2014');
  });
});
