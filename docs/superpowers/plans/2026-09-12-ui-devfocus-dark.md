# UptimeKit UI: DevFocus Dark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the UptimeKit dashboard to the DevFocus Dark design system and surface the latency statistics the app already fetches and throws away.

**Architecture:** The app already separates page background (`bg-background`) from card background (`bg-surface`), so the entire re-skin lands by changing token *values* in `tailwind.config.js` — no class renames, no migration shim, no broken intermediate state. Structural work (radius normalization, shadow removal, layout, copy) then proceeds file by file. Data work widens `PingMetric` to stop discarding four columns that `select_ping_tier` already returns, and adds one pure-function module for window statistics.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind 3.4, Recharts 2.12, Vitest 4, `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-09-12-ui-design-system-design.md`
**Design system:** `docs/design-system.md`

## Global Constraints

- **Run all web commands from `src/web`.** It is a separate npm project from the repo root. `npm test` there runs Vitest; the repo root has its own suite.
- **Never run anything against `DATABASE_URL`.** It points at the production Supabase project. The only database any task may touch is `DATABASE_TEST_URL` (`postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test`).
- **No SQL changes.** Every value this plan surfaces is already in the response payload. `supabase/schema.sql` is not edited by any task here.
- **No new routes and no new dependencies.** Sparklines are hand-rolled inline SVG; Recharts and `lucide-react` are already installed and are the only chart/icon sources.
- **Do not import from `@/lib/server/data/*` inside a component.** The repo's ESLint config has a `no-restricted-imports` rule that fails `next build`. Shared types belong in `lib/shared/types.ts`.
- **Contrast floor is 4.5:1 for text** (the design system says 4:1; this plan holds the stricter WCAG AA number). Task 1 makes this machine-checked.
- **Radius is 8px (`rounded-lg`) everywhere.** No `rounded-md`, `rounded-xl`, `rounded-2xl`, or `rounded-full` survives except where a shape is genuinely a circle (a loading spinner).
- **No elevation.** No `shadow-*` class and no `glow-*` class survives anywhere.
- **Uppercase is for section headers only.** Every one of the app's 20 current `uppercase tracking-wider` usages is an inline field or stat label and becomes sentence case.
- **Status is always carried by a word**, never by colour alone.
- **Commit after every task** using the message given in that task's final step.

### Token values (set once in Task 1, referenced by every later task)

| Tailwind name | Hex | Role |
| --- | --- | --- |
| `background` | `#0b1326` | Page background |
| `surface` | `#172340` | Card and input background |
| `surface-hover` | `#1f2e52` | Row and button hover |
| `surface-border` | `#2a3a5c` | Card borders, hairlines |
| `slate-100` / `slate-200` | `#dae2fd` | Body text — 14.3:1 |
| `slate-300` | `#a8b2cf` | Tertiary text |
| `slate-400` / `500` / `600` | `#8f9bbd` | Secondary text — 6.7:1 |
| `slate-700` | `#2a3a5c` | Borders |
| `slate-800` | `#172340` | Chips |
| `brand-400` | `#7ca3fe` | Link and interactive **text** — 7.5:1 |
| `brand-500` / `brand-600` | `#2665fd` | Fills and active states; label on it is **white** (4.8:1) |
| `status-up` / `emerald-400` | `#90dfba` | The word `up` |
| `status-degraded` / `amber-400` | `#ffd285` | The word `degraded`, tier notes |
| `status-down` / `red-400` | `#ffb4ab` | The word `down`, error text and borders |

`brand-500`/`600` at 3.84:1 must never be used as text on a background. `slate-600` at `#475569` must never be used as text.

---

## File Structure

**Created:**
- `src/web/lib/shared/stats.ts` — `percentile()` and `summarize()`. Pure, no React, no imports from the server layer.
- `src/web/lib/shared/sparkline.ts` — `sparklinePath()`. Pure geometry, separated from the component so it is testable without a DOM.
- `src/web/components/monitors/sparkline.tsx` — inline-SVG sparkline.
- `src/web/components/monitors/stat-row.tsx` — the latency/uptime figures shown above a chart and inside a monitor row.
- `src/web/components/monitors/tier-note.tsx` — the rolled-up-tier disclosure, lifted out of the share page so both charts use it.
- `src/web/components/monitors/monitor-row.tsx` — replaces `monitor-card.tsx`.
- `src/web/tests/tokens.test.ts`, `stats.test.ts`, `sparkline.test.ts`, `monitor-order.test.ts`
- `scripts/seed-dev.ts` (repo root)

**Modified:** `tailwind.config.js`, `app/globals.css`, `app/layout.tsx`, `lib/shared/types.ts`, `lib/shared/utils.ts`, `lib/server/data/monitors.ts`, `lib/server/data/saved-views.ts`, `app/share/[token]/page.tsx`, and every file in the sweep list in Task 7.

**Deleted:** `src/web/components/monitors/monitor-card.tsx` (becomes `monitor-row.tsx`).

---

### Task 1: Tokens, typeface, and a machine-checked contrast floor

**Files:**
- Modify: `src/web/tailwind.config.js`
- Modify: `src/web/app/globals.css`
- Modify: `src/web/app/layout.tsx`
- Test: `src/web/tests/tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the Tailwind colour tokens in the Global Constraints table, and `fontFamily.sans` resolving to Inter via the CSS variable `--font-inter`. Every later task uses these class names.

- [ ] **Step 1: Write the failing test**

Create `src/web/tests/tokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../tailwind.config.js');

const colors = config.theme.extend.colors;

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('design tokens', () => {
  const bg = colors.background;

  it('uses the design system surface colour', () => {
    expect(bg).toBe('#0b1326');
    expect(colors.surface.DEFAULT).toBe('#172340');
  });

  // The card must be legible by fill AND by border, per docs/design-system.md.
  it('separates the card from the page by more than a hairline', () => {
    expect(contrast(colors.surface.DEFAULT, bg)).toBeGreaterThan(1.15);
    expect(contrast(colors.surface.border, bg)).toBeGreaterThan(1.5);
  });

  it.each([
    ['body text', 'slate', '100'],
    ['tertiary text', 'slate', '300'],
    ['secondary text', 'slate', '400'],
    ['secondary text', 'slate', '500'],
    ['secondary text', 'slate', '600'],
    ['link text', 'brand', '400'],
  ])('%s (%s-%s) clears AA on the page', (_label, family, shade) => {
    expect(contrast(colors[family][shade], bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['up', 'degraded', 'down'])('status %s clears AA on the page', (name) => {
    expect(contrast(colors.status[name], bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('clears AA for every text token on a card, not just the page', () => {
    const card = colors.surface.DEFAULT;
    for (const shade of ['100', '300', '400']) {
      expect(contrast(colors.slate[shade], card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // brand-600 is a fill. Its label is white, never on-surface.
  it('carries a white label on the primary fill', () => {
    expect(contrast('#ffffff', colors.brand['600'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the primary out of the text palette', () => {
    expect(contrast(colors.brand['600'], bg)).toBeLessThan(4.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run tests/tokens.test.ts`
Expected: FAIL — `expect(bg).toBe('#0b1326')` receives `'#0B0F17'`.

- [ ] **Step 3: Replace the colour block in `tailwind.config.js`**

Replace the whole `theme.extend` object with:

```javascript
  theme: {
    extend: {
      // Inter is injected by next/font in app/layout.tsx as --font-inter.
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // DevFocus Dark — docs/design-system.md.
      //
      // The system names these surface / on-surface / primary / secondary /
      // error. The Tailwind names below are the ones already used throughout
      // this app, retinted in place: `background` is the page, `surface` is a
      // card. Retinting rather than renaming means the whole app re-skins
      // without touching a single component.
      //
      // Ratios are against `background` and are enforced by tests/tokens.test.ts.
      colors: {
        background: '#0b1326',
        surface: {
          DEFAULT: '#172340', // card / input fill
          hover: '#1f2e52',
          border: '#2a3a5c',  // system: outline
        },
        // system: primary. 500/600 are FILLS — 3.84:1, never text.
        // 400 is the text-safe tint at 7.5:1.
        brand: {
          400: '#7ca3fe',
          500: '#2665fd',
          600: '#2665fd',
          700: '#1b4fd8',
        },
        // Neutral text ramp. system: on-surface, dimmed.
        slate: {
          50: '#eaf0ff',
          100: '#dae2fd',
          200: '#dae2fd',
          300: '#a8b2cf',
          400: '#8f9bbd',
          500: '#8f9bbd',
          600: '#8f9bbd',
          700: '#2a3a5c',
          800: '#172340',
        },
        // Status lands on the status WORD and nowhere else.
        status: {
          up: '#90dfba',
          degraded: '#ffd285',
          down: '#ffb4ab',
          unknown: '#8f9bbd',
        },
        // Retinted so the handful of non-badge usages stay coherent.
        emerald: { 400: '#90dfba', 500: '#90dfba' },
        amber: { 400: '#ffd285', 500: '#ffd285' },
        red: { 400: '#ffb4ab', 500: '#ffb4ab' },
      },
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/web && npx vitest run tests/tokens.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Load Inter**

In `src/web/app/layout.tsx`, add above the metadata export:

```typescript
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
```

and put the variable on `<html>`:

```typescript
    <html lang="en" className={`dark ${inter.variable}`}>
```

- [ ] **Step 6: Rewrite `app/globals.css`**

Replace the whole file:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-background text-slate-100 antialiased selection:bg-brand-600 selection:text-white;
    /* cv02/03/04/11 are Inter's alternate glyph forms. tnum makes digits
       tabular, so latency columns align and a value going 99 -> 100 does not
       reflow its row. It is why this app needs no second, monospace family. */
    font-feature-settings: "cv02", "cv03", "cv04", "cv11", "tnum";
  }

  /* One visible focus style for everything, per the design system's 8px rule. */
  :focus-visible {
    @apply outline-none ring-2 ring-brand-500 ring-offset-2 ring-offset-background rounded-lg;
  }
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: #0b1326;
}

::-webkit-scrollbar-thumb {
  background: #2a3a5c;
  border-radius: 8px;
}

::-webkit-scrollbar-thumb:hover {
  background: #475569;
}

/* The design system forbids elevation, so .glow-emerald, .glow-red and
   .glow-brand are gone. Separation comes from fill and border alone. */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 7: Verify the app still compiles and nothing references the deleted utilities**

Run: `cd src/web && npx tsc --noEmit && grep -rn "glow-" app components || echo "NO GLOW REFERENCES"`
Expected: tsc clean. The grep will still list `glow-brand` / `glow-emerald` / `glow-red` usages in components — that is expected at this stage; they now resolve to nothing and are removed in Tasks 4 and 7. Record the list.

- [ ] **Step 8: Commit**

```bash
git add src/web/tailwind.config.js src/web/app/globals.css src/web/app/layout.tsx src/web/tests/tokens.test.ts
git commit -m "feat(ui): adopt DevFocus Dark tokens and load Inter

Retints the existing token names in place rather than renaming classes, so
the whole app re-skins without touching a component. tokens.test.ts enforces
the 4.5:1 contrast floor so the palette cannot silently regress.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

### Task 2: Seed a demo team so later tasks have something to look at

**Files:**
- Create: `scripts/seed-dev.ts` (repo root project, not `src/web`)

**Interfaces:**
- Consumes: nothing.
- Produces: rows in the local test database only. No code imports this.

Model it on `scripts/backfill-daily-rollups.ts`, which already guards a destructive script by requiring an env var to name the target database. `pg`, `dotenv` and `ts-node` are already root dependencies — add nothing.

- [ ] **Step 1: Write the script**

Create `scripts/seed-dev.ts`:

```typescript
/**
 * Seeds a demo team with believable traffic, for looking at the dashboard.
 *
 *   SEED_CONFIRM=uptimekit_sdd_test npx ts-node scripts/seed-dev.ts
 *
 * DATABASE_URL in this repo's .env points at production, so this script never
 * reads it. It uses DATABASE_TEST_URL and refuses to run unless SEED_CONFIRM
 * names that exact database — the same guard as backfill-daily-rollups.ts.
 */
import 'dotenv/config';
import { Client } from 'pg';

const MONITORS = [
  { name: 'api', url: 'https://api.acme.test/health', base: 140, status: 'up' },
  { name: 'checkout-api', url: 'https://checkout.acme.test/health', base: 220, status: 'down' },
  { name: 'web', url: 'https://acme.test', base: 310, status: 'up' },
  { name: 'cdn-edge', url: 'https://cdn.acme.test/ping', base: 45, status: 'up' },
  { name: 'auth-service', url: 'https://auth.acme.test/healthz', base: 180, status: 'degraded' },
  { name: 'search', url: 'https://search.acme.test/health', base: 520, status: 'up' },
];

const DAYS = 3;
const INTERVAL_SECONDS = 300;

/** Latency that drifts over the day and spikes during an outage. */
function latencyAt(base: number, minuteOfDay: number, inOutage: boolean): number {
  const diurnal = 1 + 0.25 * Math.sin((minuteOfDay / 1440) * 2 * Math.PI);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(base * diurnal * jitter * (inOutage ? 4 : 1));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_TEST_URL;
  if (!url) throw new Error('DATABASE_TEST_URL is not set');

  const dbName = new URL(url).pathname.slice(1);
  if (process.env.SEED_CONFIRM !== dbName) {
    throw new Error(
      `Refusing to seed. Re-run with SEED_CONFIRM=${dbName} once you are sure ` +
        `DATABASE_TEST_URL points where you think it does.`
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query('BEGIN');

    const { rows: [team] } = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('Acme Engineering') RETURNING id`
    );

    const now = Date.now();
    // One resolved outage yesterday and one still open on checkout-api.
    const outageStart = now - 26 * 3600 * 1000;
    const outageEnd = outageStart + 40 * 60 * 1000;
    const liveOutageStart = now - 4 * 60 * 1000;

    for (const m of MONITORS) {
      const { rows: [monitor] } = await client.query<{ id: string }>(
        `INSERT INTO monitors (team_id, name, url, check_interval, timeout_ms, status)
         VALUES ($1, $2, $3, $4, 10000, $5) RETURNING id`,
        [team.id, m.name, m.url, INTERVAL_SECONDS, m.status]
      );

      const points: string[] = [];
      const values: unknown[] = [];
      let n = 0;

      for (let t = now - DAYS * 86400 * 1000; t <= now; t += INTERVAL_SECONDS * 1000) {
        const isCheckout = m.name === 'checkout-api';
        const inOutage =
          isCheckout && ((t >= outageStart && t <= outageEnd) || t >= liveOutageStart);
        const minuteOfDay = new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();

        values.push(
          monitor.id,
          new Date(t).toISOString(),
          inOutage ? 0 : latencyAt(m.base, minuteOfDay, false),
          inOutage ? 503 : 200
        );
        points.push(`($${++n}, $${++n}, $${++n}, $${++n})`);
      }

      await client.query(
        `INSERT INTO ping_logs_raw (monitor_id, timestamp, response_time_ms, status_code)
         VALUES ${points.join(',')}`,
        values
      );

      if (m.name === 'checkout-api') {
        await client.query(
          `INSERT INTO incidents (team_id, monitor_id, started_at, resolved_at, cause)
           VALUES ($1, $2, $3, $4, 'HTTP 503'), ($1, $2, $5, NULL, 'HTTP 503')`,
          [team.id, monitor.id, new Date(outageStart), new Date(outageEnd), new Date(liveOutageStart)]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded team ${team.id} with ${MONITORS.length} monitors over ${DAYS} days.`);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 2: Prove the guard refuses by default**

Run: `npx ts-node scripts/seed-dev.ts`
Expected: exits non-zero with `Refusing to seed. Re-run with SEED_CONFIRM=uptimekit_sdd_test ...`

- [ ] **Step 3: Seed, and verify the rows landed**

Run:
```bash
SEED_CONFIRM=uptimekit_sdd_test npx ts-node scripts/seed-dev.ts
psql "$DATABASE_TEST_URL" -c "SELECT m.name, m.status, count(p.*) AS pings FROM monitors m LEFT JOIN ping_logs_raw p ON p.monitor_id = m.id GROUP BY 1,2 ORDER BY 1;"
```
Expected: six monitors, each with roughly `3 * 288 = 864` pings; `checkout-api` shows status `down`.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-dev.ts
git commit -m "feat(dev): seed a demo team with three days of believable traffic

Guarded the same way backfill-daily-rollups.ts is: reads DATABASE_TEST_URL
only, and refuses unless SEED_CONFIRM names that database, because
DATABASE_URL in this repo points at production.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

### Task 3: Stop discarding the statistics the database already returns

**Files:**
- Modify: `src/web/lib/shared/types.ts`
- Modify: `src/web/lib/server/data/monitors.ts:107-125`
- Modify: `src/web/lib/server/data/saved-views.ts:88-102`
- Modify: `src/web/app/share/[token]/page.tsx:31-36`
- Create: `src/web/lib/shared/stats.ts`
- Test: `src/web/tests/stats.test.ts` (create), `src/web/tests/mapping.test.ts` (update)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `PingMetric` gains `minMs: number | null`, `maxMs: number | null`, `p95Ms: number | null`, `sampleCount: number`, `sourceTier: Tier`.
  - `SharedViewPoint` gains `minMs: number | null`, `maxMs: number | null`.
  - `export type Tier = 'raw' | 'hourly' | 'daily'`
  - `export function percentile(sorted: number[], p: number): number`
  - `export function summarize(metrics: PingMetric[], tier: Tier): WindowStats | null`
  - `export interface WindowStats { meanMs; p50Ms; p95Ms; p99Ms; peakP95Ms; uptime; sampleCount; tier }`

- [ ] **Step 1: Write the failing test**

Create `src/web/tests/stats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { percentile, summarize } from '../lib/shared/stats';
import type { PingMetric } from '../lib/shared/types';

function point(overrides: Partial<PingMetric> = {}): PingMetric {
  return {
    timestamp: '2026-09-12T00:00:00Z',
    responseTimeMs: 100,
    statusCode: 200,
    isUp: true,
    minMs: null,
    maxMs: null,
    p95Ms: null,
    sampleCount: 1,
    sourceTier: 'raw',
    ...overrides,
  };
}

describe('percentile', () => {
  // Linear interpolation, matching Postgres PERCENTILE_CONT, so a percentile
  // computed here and one computed in SQL agree.
  it('interpolates between neighbours the way PERCENTILE_CONT does', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('returns the bounds at 0 and 1', () => {
    expect(percentile([5, 9, 14], 0)).toBe(5);
    expect(percentile([5, 9, 14], 1)).toBe(14);
  });

  it('handles a single sample', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('refuses an empty list rather than returning a misleading zero', () => {
    expect(() => percentile([], 0.5)).toThrow();
  });
});

describe('summarize', () => {
  it('returns null for an empty window', () => {
    expect(summarize([], 'raw')).toBeNull();
  });

  it('computes exact percentiles on the raw tier', () => {
    const metrics = [100, 200, 300, 400].map((ms) => point({ responseTimeMs: ms }));
    const stats = summarize(metrics, 'raw')!;

    expect(stats.meanMs).toBe(250);
    expect(stats.p50Ms).toBe(250);
    expect(stats.p95Ms).toBe(385);
    expect(stats.tier).toBe('raw');
  });

  // A window p95 cannot be recovered from per-bucket summaries, so the rolled
  // up tiers must not claim one. This is the spec's central honesty rule.
  it('refuses to report window percentiles on rolled-up tiers', () => {
    const metrics = [100, 200].map((ms) => point({ responseTimeMs: ms, sourceTier: 'hourly', p95Ms: ms * 2 }));
    const stats = summarize(metrics, 'hourly')!;

    expect(stats.p50Ms).toBeNull();
    expect(stats.p95Ms).toBeNull();
    expect(stats.p99Ms).toBeNull();
  });

  it('reports the peak bucket p95 on the hourly tier, where buckets are exact', () => {
    const metrics = [
      point({ sourceTier: 'hourly', p95Ms: 300 }),
      point({ sourceTier: 'hourly', p95Ms: 900 }),
    ];
    expect(summarize(metrics, 'hourly')!.peakP95Ms).toBe(900);
  });

  // percentile_source never reaches the client, so a daily p95 may be a
  // percentile of percentiles with unbounded error. Report nothing.
  it('reports no percentile at all on the daily tier', () => {
    const metrics = [point({ sourceTier: 'daily', p95Ms: 900 })];
    const stats = summarize(metrics, 'daily')!;

    expect(stats.peakP95Ms).toBeNull();
    expect(stats.p95Ms).toBeNull();
  });

  it('measures uptime as the share of points that were up', () => {
    const metrics = [
      point({ isUp: true }),
      point({ isUp: true }),
      point({ isUp: true }),
      point({ isUp: false }),
    ];
    expect(summarize(metrics, 'raw')!.uptime).toBe(0.75);
  });

  it('sums the samples a rolled-up window stands for', () => {
    const metrics = [
      point({ sourceTier: 'hourly', sampleCount: 12 }),
      point({ sourceTier: 'hourly', sampleCount: 11 }),
    ];
    expect(summarize(metrics, 'hourly')!.sampleCount).toBe(23);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run tests/stats.test.ts`
Expected: FAIL — `Cannot find module '../lib/shared/stats'`.

- [ ] **Step 3: Widen the types**

In `src/web/lib/shared/types.ts`, replace the `PingMetric` interface:

```typescript
/** Which rollup tier served a point. Raw rows are individual samples; the
 *  other two are pre-aggregated buckets and cannot support a window
 *  percentile. */
export type Tier = 'raw' | 'hourly' | 'daily';

/**
 * Single time-series ping performance metric entry.
 */
export interface PingMetric {
  /** ISO 8601 timestamp of ping measurement */
  timestamp: string;
  /** Response time in milliseconds — the sample on `raw`, the mean otherwise */
  responseTimeMs: number;
  /** Returned HTTP status code (e.g. 200, 500, or null) */
  statusCode: number | null;
  /** Operational success status */
  isUp: boolean;
  /** Fastest sample in this bucket; null on the raw tier */
  minMs: number | null;
  /** Slowest sample in this bucket; null on the raw tier */
  maxMs: number | null;
  /** This bucket's p95; null on the raw tier. Exact for hourly buckets;
   *  on daily it may be a percentile of percentiles, and nothing in the
   *  payload says which, so the UI never labels it a percentile. */
  p95Ms: number | null;
  /** How many raw samples this point stands for */
  sampleCount: number;
  /** Which tier served this point */
  sourceTier: Tier;
}
```

and add the two fields to `SharedViewPoint`:

```typescript
export interface SharedViewPoint {
  timestamp: string;
  responseTimeMs: number;
  p95Ms: number;
  sampleCount: number;
  /** get_shared_view returns these and toSharedView used to drop them. */
  minMs: number | null;
  maxMs: number | null;
}
```

- [ ] **Step 4: Write `lib/shared/stats.ts`**

```typescript
import type { PingMetric, Tier } from './types';

/** Window-level figures, with nulls wherever the tier cannot support a claim. */
export interface WindowStats {
  /** Arithmetic mean of every point. Always available. */
  meanMs: number;
  /** Exact percentiles. Raw tier only — null everywhere else. */
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Highest per-bucket p95. Hourly only, where each bucket's p95 was computed
   *  by PERCENTILE_CONT over that hour's real samples. Null on daily, whose
   *  provenance flag never reaches the client. */
  peakP95Ms: number | null;
  /** Share of points reporting up, 0..1. */
  uptime: number;
  /** How many raw samples the window represents. */
  sampleCount: number;
  tier: Tier;
}

/**
 * Linear-interpolating percentile, matching Postgres PERCENTILE_CONT so a
 * figure computed here agrees with one computed in SQL.
 * @param sorted values in ascending order
 * @param p quantile in 0..1
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of an empty list');
  if (sorted.length === 1) return sorted[0];

  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Reduces a window to the figures its tier can honestly support.
 *
 * Rolled-up tiers carry pre-aggregated buckets, and a window percentile cannot
 * be recovered from bucket summaries — so p50/p95/p99 are null there rather
 * than approximated. Returns null for an empty window.
 */
export function summarize(metrics: PingMetric[], tier: Tier): WindowStats | null {
  if (metrics.length === 0) return null;

  const exact = tier === 'raw';
  const latencies = metrics.map((m) => m.responseTimeMs).sort((a, b) => a - b);
  const mean = latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length;
  const bucketP95s = metrics
    .map((m) => m.p95Ms)
    .filter((ms): ms is number => ms !== null);

  return {
    meanMs: Math.round(mean),
    p50Ms: exact ? Math.round(percentile(latencies, 0.5)) : null,
    p95Ms: exact ? Math.round(percentile(latencies, 0.95)) : null,
    p99Ms: exact ? Math.round(percentile(latencies, 0.99)) : null,
    peakP95Ms: tier === 'hourly' && bucketP95s.length > 0 ? Math.max(...bucketP95s) : null,
    uptime: metrics.filter((m) => m.isUp).length / metrics.length,
    sampleCount: metrics.reduce((sum, m) => sum + (m.sampleCount || 1), 0),
    tier,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src/web && npx vitest run tests/stats.test.ts`
Expected: PASS.

- [ ] **Step 6: Stop discarding the columns in the mappers**

In `src/web/lib/server/data/monitors.ts`, widen `TierRow` and `toPingMetric`:

```typescript
export interface TierRow {
  /** Named `ts` in SQL — an output column named `timestamp` is a Postgres syntax error. */
  ts: string;
  response_time_ms: number;
  min_time_ms: number | null;
  max_time_ms: number | null;
  p95_time_ms: number | null;
  sample_count: number | null;
  status_code: number | null;
  source_tier: string;
}

export function toPingMetric(row: TierRow): PingMetric {
  return {
    timestamp: row.ts,
    responseTimeMs: Math.round(Number(row.response_time_ms)),
    statusCode: row.status_code,
    // Rolled-up tiers average away individual failures, so only raw rows can
    // report a point as down.
    isUp: row.source_tier !== 'raw' || (row.status_code !== null && row.status_code < 400),
    minMs: row.min_time_ms,
    maxMs: row.max_time_ms,
    p95Ms: row.p95_time_ms,
    sampleCount: row.sample_count ?? 1,
    sourceTier: row.source_tier as PingMetric['sourceTier'],
  };
}
```

In `src/web/lib/server/data/saved-views.ts`, add the two fields the row interface already declares to the `points` mapping (around line 97):

```typescript
      minMs: row.min_time_ms,
      maxMs: row.max_time_ms,
```

- [ ] **Step 7: Convert the share page's hand-built objects to a named mapper**

In `src/web/app/share/[token]/page.tsx`, replace the inline `shared.points.map(...)` with:

```typescript
/** A shared point carries no status code — get_shared_view never returns one —
 *  so a public chart cannot distinguish up from down and does not try. */
function toChartPoint(point: SharedViewPoint, tier: string): PingMetric {
  return {
    timestamp: point.timestamp,
    responseTimeMs: point.responseTimeMs,
    statusCode: null,
    isUp: true,
    minMs: point.minMs,
    maxMs: point.maxMs,
    p95Ms: point.p95Ms,
    sampleCount: point.sampleCount,
    sourceTier: tier as PingMetric['sourceTier'],
  };
}
```

and call it: `const metrics = shared.points.map((p) => toChartPoint(p, shared.sourceTier));`
Import `PingMetric` and `SharedViewPoint` from `@/lib/shared/types`.

- [ ] **Step 8: Update `tests/mapping.test.ts` for the widened mapper**

The existing `toPingMetric` cases construct `TierRow` literals. Add the four new columns to each literal and assert they survive:

```typescript
  it('carries the statistics the tier function already returns', () => {
    const metric = toPingMetric({
      ts: '2026-09-12T00:00:00Z',
      response_time_ms: 150,
      min_time_ms: 90,
      max_time_ms: 400,
      p95_time_ms: 380,
      sample_count: 12,
      status_code: 200,
      source_tier: 'hourly',
    });

    expect(metric.minMs).toBe(90);
    expect(metric.maxMs).toBe(400);
    expect(metric.p95Ms).toBe(380);
    expect(metric.sampleCount).toBe(12);
    expect(metric.sourceTier).toBe('hourly');
  });

  it('defaults sample count to one for a raw sample', () => {
    const metric = toPingMetric({
      ts: '2026-09-12T00:00:00Z',
      response_time_ms: 150,
      min_time_ms: null,
      max_time_ms: null,
      p95_time_ms: null,
      sample_count: null,
      status_code: 200,
      source_tier: 'raw',
    });

    expect(metric.sampleCount).toBe(1);
  });
```

- [ ] **Step 9: Run the full web suite and the type checker**

Run: `cd src/web && npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc clean. If `saved-views.test.ts` fails on the widened `SharedViewPoint`, add `minMs`/`maxMs` to its fixtures.

- [ ] **Step 10: Commit**

```bash
git add src/web/lib src/web/app/share src/web/tests
git commit -m "feat(ui): carry the latency statistics select_ping_tier already returns

toPingMetric discarded min/max/p95/sample_count on every request, and
toSharedView dropped min/max identically. Adds stats.ts, whose summarize()
returns null percentiles on rolled-up tiers rather than approximating one:
percentile_source never reaches the client, so a daily p95 may be a
percentile of percentiles with unbounded error.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

### Task 4: Presentation primitives — status, sparkline, stat row, tier note

**Files:**
- Modify: `src/web/components/monitors/status-badge.tsx`
- Create: `src/web/lib/shared/sparkline.ts`
- Create: `src/web/components/monitors/sparkline.tsx`
- Create: `src/web/components/monitors/stat-row.tsx`
- Create: `src/web/components/monitors/tier-note.tsx`
- Modify: `src/web/lib/shared/utils.ts`
- Test: `src/web/tests/sparkline.test.ts` (create)

**Interfaces:**
- Consumes: `WindowStats`, `summarize`, `Tier` from Task 3.
- Produces:
  - `export function sparklinePath(values: number[], width: number, height: number): string`
  - `export function formatRelative(iso: string | null): string`
  - `<StatusWord status={MonitorStatus} />`
  - `<Sparkline values={number[]} width?={number} height?={number} />`
  - `<StatRow stats={WindowStats} />`
  - `<TierNote tier={Tier} />`

- [ ] **Step 1: Write the failing test**

Create `src/web/tests/sparkline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sparklinePath } from '../lib/shared/sparkline';
import { formatRelative } from '../lib/shared/utils';

describe('sparklinePath', () => {
  it('returns an empty string when there is nothing to draw', () => {
    expect(sparklinePath([], 100, 20)).toBe('');
  });

  it('draws a flat line through the middle for a single value', () => {
    expect(sparklinePath([5], 100, 20)).toBe('M 0 10 L 100 10');
  });

  // A flat series has no range; dividing by zero would produce NaN in the path
  // and the SVG would silently render nothing.
  it('draws a flat line rather than NaN when every value is equal', () => {
    const path = sparklinePath([7, 7, 7], 100, 20);
    expect(path).not.toContain('NaN');
    expect(path).toBe('M 0 10 L 50 10 L 100 10');
  });

  it('puts the lowest value at the bottom and the highest at the top', () => {
    // y is inverted: 0 is the top of an SVG viewport.
    expect(sparklinePath([0, 10], 100, 20)).toBe('M 0 20 L 100 0');
  });
});

describe('formatRelative', () => {
  it('reads never when there is no timestamp', () => {
    expect(formatRelative(null)).toBe('never');
  });

  it('counts seconds, then minutes, then hours, then days', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 12_000).toISOString())).toBe('12s ago');
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(formatRelative(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h ago');
    expect(formatRelative(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run tests/sparkline.test.ts`
Expected: FAIL — `Cannot find module '../lib/shared/sparkline'`.

- [ ] **Step 3: Write `lib/shared/sparkline.ts`**

```typescript
/**
 * Builds an SVG polyline path for a sparkline, normalised to fill the box.
 *
 * Hand-rolled rather than pulled from a library: it is nine lines, and the app
 * already carries Recharts for the charts that actually need axes.
 *
 * @param values series in time order
 * @param width viewport width
 * @param height viewport height
 * @returns an SVG path, or '' when there is nothing to draw
 */
export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `M 0 ${height / 2} L ${width} ${height / 2}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width;
      // A flat series has no range; centre it instead of dividing by zero.
      const y = range === 0 ? height / 2 : height - ((value - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'} ${Math.round(x)} ${Math.round(y)}`;
    })
    .join(' ');
}
```

- [ ] **Step 4: Add `formatRelative` to `lib/shared/utils.ts`**

```typescript
/**
 * Renders a timestamp as elapsed time. A dashboard reader wants "12s ago",
 * not an absolute clock time they have to subtract from.
 * @param isoString ISO 8601 timestamp or null
 */
export function formatRelative(isoString: string | null): string {
  if (!isoString) return 'never';

  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src/web && npx vitest run tests/sparkline.test.ts`
Expected: PASS.

- [ ] **Step 6: Rewrite `status-badge.tsx` as a status word**

Replace the file:

```typescript
import { MonitorStatus } from '@/lib/shared/types';
import { cn } from '@/lib/shared/utils';

export interface StatusWordProps {
  status: MonitorStatus;
  className?: string;
}

/**
 * The monitor's state, as a word.
 *
 * Colour is carried by the text and never by a fill, a pill or a dot: a
 * healthy board stays near-monochrome so the one unhealthy row is impossible
 * to miss. The word is always present, which is also what makes this readable
 * without colour vision.
 */
export function StatusWord({ status, className }: StatusWordProps) {
  const labels: Record<MonitorStatus, string> = {
    up: 'up',
    down: 'down',
    degraded: 'degraded',
    unknown: 'not checked yet',
  };

  const tones: Record<MonitorStatus, string> = {
    up: 'text-status-up',
    down: 'text-status-down',
    degraded: 'text-status-degraded',
    unknown: 'text-slate-400',
  };

  return (
    <span className={cn('text-sm font-medium', tones[status], className)}>
      {labels[status] ?? labels.unknown}
    </span>
  );
}
```

- [ ] **Step 7: Write the three presentation components**

`src/web/components/monitors/sparkline.tsx`:

```typescript
import { sparklinePath } from '@/lib/shared/sparkline';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

/** A bare latency trace. No axes, no interaction — those live in the chart. */
export function Sparkline({ values, width = 160, height = 24, className }: SparklineProps) {
  const path = sparklinePath(values, width, height);
  if (!path) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Recent response times, ${values.length} samples`}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
```

`src/web/components/monitors/stat-row.tsx`:

```typescript
import type { WindowStats } from '@/lib/shared/stats';

/** One figure and what it is. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-100">{value}</span>
    </div>
  );
}

/**
 * The window's figures, showing only what its tier can support. On rolled-up
 * tiers `summarize` returns null percentiles, so those stats simply do not
 * render rather than displaying an approximation as though it were exact.
 */
export function StatRow({ stats }: { stats: WindowStats }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <Stat label="uptime" value={`${(stats.uptime * 100).toFixed(2)}%`} />
      <Stat label="mean" value={`${stats.meanMs}ms`} />
      {stats.p50Ms !== null && <Stat label="p50" value={`${stats.p50Ms}ms`} />}
      {stats.p95Ms !== null && <Stat label="p95" value={`${stats.p95Ms}ms`} />}
      {stats.p99Ms !== null && <Stat label="p99" value={`${stats.p99Ms}ms`} />}
      {stats.peakP95Ms !== null && <Stat label="peak hourly p95" value={`${stats.peakP95Ms}ms`} />}
      <Stat label="samples" value={stats.sampleCount.toLocaleString()} />
    </div>
  );
}
```

`src/web/components/monitors/tier-note.tsx`:

```typescript
import type { Tier } from '@/lib/shared/types';

const NOTES: Partial<Record<Tier, string>> = {
  hourly:
    'This window is rolled up to hourly averages. Each hour\u2019s p95 is exact; a single figure for the whole window is not.',
  daily:
    'This window is rolled up to daily averages. Percentiles at this range are approximate and are not shown.',
};

/** Says when the numbers above it are summaries rather than samples. */
export function TierNote({ tier }: { tier: Tier }) {
  const note = NOTES[tier];
  if (!note) return null;

  return <p className="text-xs text-status-degraded">{note}</p>;
}
```

- [ ] **Step 8: Update every import of the old `StatusBadge`**

Run: `cd src/web && grep -rn "StatusBadge" app components`
Rename each usage to `StatusWord`. Expected call sites: `components/monitors/monitor-card.tsx`, `components/monitors/monitor-detail-view.tsx`, `app/share/[token]/page.tsx`.

- [ ] **Step 9: Verify**

Run: `cd src/web && npx vitest run && npx tsc --noEmit`
Expected: all pass, tsc clean.

- [ ] **Step 10: Commit**

```bash
git add src/web/lib src/web/components src/web/tests
git commit -m "feat(ui): status word, sparkline, stat row and tier note

Status becomes a word rather than a glowing pill, so a healthy board stays
near-monochrome and colour is never the only carrier. StatRow renders only
the figures summarize() was willing to compute for that tier.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

### Task 5: Monitors list — stacked rows, urgent first

**Files:**
- Create: `src/web/components/monitors/monitor-row.tsx`
- Delete: `src/web/components/monitors/monitor-card.tsx`
- Modify: `src/web/components/monitors/monitor-list.tsx`
- Modify: `src/web/app/dashboard/monitors/page.tsx`
- Modify: `src/web/lib/shared/utils.ts`
- Test: `src/web/tests/monitor-order.test.ts` (create)

**Interfaces:**
- Consumes: `StatusWord`, `Sparkline`, `formatRelative` from Task 4.
- Produces: `export function byUrgency(a: Monitor, b: Monitor): number`

- [ ] **Step 1: Write the failing test**

Create `src/web/tests/monitor-order.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { byUrgency } from '../lib/shared/utils';
import type { Monitor, MonitorStatus } from '../lib/shared/types';

function monitor(name: string, status: MonitorStatus): Monitor {
  return {
    id: name,
    teamId: 't1',
    name,
    url: `https://${name}.test`,
    intervalSeconds: 300,
    timeoutMs: 10000,
    status,
    lastCheckedAt: '2026-09-12T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
  };
}

describe('byUrgency', () => {
  // The whole point of the redesign: a broken endpoint must not sit below a
  // healthy one just because it was created later.
  it('puts down first, then degraded, then unchecked, then up', () => {
    const sorted = [
      monitor('d', 'up'),
      monitor('c', 'unknown'),
      monitor('b', 'degraded'),
      monitor('a', 'down'),
    ]
      .sort(byUrgency)
      .map((m) => m.name);

    expect(sorted).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to name so the order is stable between renders', () => {
    const sorted = [monitor('zeta', 'up'), monitor('alpha', 'up')].sort(byUrgency).map((m) => m.name);
    expect(sorted).toEqual(['alpha', 'zeta']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run tests/monitor-order.test.ts`
Expected: FAIL — `byUrgency is not a function`.

- [ ] **Step 3: Add `byUrgency` to `lib/shared/utils.ts`**

```typescript
import type { Monitor, MonitorStatus } from './types';

/** Lower sorts first. Anything needing attention outranks anything healthy. */
const URGENCY: Record<MonitorStatus, number> = {
  down: 0,
  degraded: 1,
  unknown: 2,
  up: 3,
};

/**
 * Orders monitors by how much they need a human, then by name so the list does
 * not reshuffle between renders.
 */
export function byUrgency(a: Monitor, b: Monitor): number {
  return URGENCY[a.status] - URGENCY[b.status] || a.name.localeCompare(b.name);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/web && npx vitest run tests/monitor-order.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `monitor-row.tsx`**

```typescript
import Link from 'next/link';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Monitor } from '@/lib/shared/types';
import { StatusWord } from './status-badge';
import { formatRelative } from '@/lib/shared/utils';
import { cn } from '@/lib/shared/utils';

export interface MonitorRowProps {
  monitor: Monitor;
  onDeleteRequest: (monitor: Monitor) => void;
}

/**
 * One monitor as a full-width row.
 *
 * Denser than a card grid, and it gives the list somewhere to put rank: a
 * monitor that is not up carries an error-toned border, the one case where the
 * whole row is the alarm.
 */
export function MonitorRow({ monitor, onDeleteRequest }: MonitorRowProps) {
  const needsAttention = monitor.status !== 'up';

  return (
    <div
      className={cn(
        'group bg-surface border rounded-lg p-4 transition-colors',
        needsAttention ? 'border-status-down/50' : 'border-surface-border hover:border-brand-500/40'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/monitors/${monitor.id}`}
              className="text-base font-semibold text-slate-100 hover:text-brand-400 transition-colors truncate"
            >
              {monitor.name}
            </Link>
            <StatusWord status={monitor.status} />
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer"
            title={monitor.url}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 transition-colors truncate max-w-full"
          >
            <span className="truncate">{monitor.url}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden sm:inline text-xs text-slate-400">
            checked {formatRelative(monitor.lastCheckedAt)}
          </span>
          <button
            onClick={() => onDeleteRequest(monitor)}
            className="text-slate-400 hover:text-status-down p-2 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label={`Delete ${monitor.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

Then delete the old file: `git rm src/web/components/monitors/monitor-card.tsx`

- [ ] **Step 6: Update `monitor-list.tsx`**

Three changes. Import `MonitorRow` and `byUrgency` instead of `MonitorCard`; sort the filtered list; stack instead of grid; and replace the copy.

```typescript
  const filteredMonitors = monitors
    .filter(
      (m) =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.url.toLowerCase().includes(search.toLowerCase())
    )
    .sort(byUrgency);
```

Replace the grid container with `<div className="space-y-2">` and render `<MonitorRow ... />`.

Copy replacements in this file:
- placeholder `Filter monitors by name or URL...` → `Filter by name or URL`
- button `Add Monitor` → `Add monitor`
- empty heading `No monitors found` → `No monitors yet`
- empty body (search) `No monitoring targets match your search filter.` → `Nothing matches that filter.`
- empty body (no search) `Get started by creating your first HTTP endpoint health check monitor.` → `Add an endpoint and UptimeKit will check it on a schedule and tell you when it breaks.`
- button `Create Monitor Now` → `Add your first monitor`
- `alert(msg)` fallback `Error deleting monitor` → `Could not delete that monitor.`

Radius: every `rounded-xl` / `rounded-2xl` in this file becomes `rounded-lg`. Remove `shadow-lg shadow-brand-600/30` and `shadow-md`.

- [ ] **Step 7: Update the page header copy**

In `src/web/app/dashboard/monitors/page.tsx`, replace the `<Header>` props:

```typescript
      <Header
        title="Monitors"
        subtitle={
          monitors.length === 0
            ? 'Nothing being checked yet'
            : `${monitors.length} endpoint${monitors.length === 1 ? '' : 's'}, ${
                monitors.filter((m) => m.status === 'down').length
              } down`
        }
      />
```

- [ ] **Step 8: Verify against seeded data**

Run: `cd src/web && npx vitest run && npx tsc --noEmit && npm run dev`
Open `http://localhost:3001/dashboard/monitors`.
Expected: `checkout-api` is the first row with a red-toned border and the word `down`; healthy rows are near-monochrome; no shadows; every corner is 8px.

- [ ] **Step 9: Commit**

```bash
git add -A src/web/components src/web/app src/web/lib src/web/tests
git commit -m "feat(ui): stack monitors as rows, most urgent first

Replaces the three-across card grid, where a down monitor looked identical to
a healthy one. byUrgency sorts broken endpoints to the top and the row carries
an error-toned border.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

### Task 6: Monitor detail — envelope, p95 line, outage shading

**Files:**
- Modify: `src/web/components/monitors/time-series-chart.tsx`
- Modify: `src/web/components/monitors/monitor-detail-view.tsx`
- Modify: `src/web/app/share/[token]/page.tsx`

**Interfaces:**
- Consumes: `summarize`, `WindowStats` (Task 3); `StatRow`, `TierNote`, `StatusWord` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Add the new series to the chart's data mapping**

In `time-series-chart.tsx`, extend the import from `recharts` to include `Line` and `ReferenceArea`, and replace `formattedData`:

```typescript
  const formattedData = metrics.map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fullTime: new Date(m.timestamp).toLocaleString(),
    latency: m.responseTimeMs,
    // Recharts draws a band from a [low, high] tuple on one dataKey.
    band: m.minMs !== null && m.maxMs !== null ? [m.minMs, m.maxMs] : null,
    p95: m.p95Ms,
    isUp: m.isUp,
    statusCode: m.statusCode,
  }));

  // Contiguous runs of down samples, so an outage is visible on the time axis
  // instead of the area silently continuing through it.
  const outages: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < formattedData.length; i++) {
    if (formattedData[i].isUp) continue;
    const start = formattedData[i].time;
    while (i + 1 < formattedData.length && !formattedData[i + 1].isUp) i++;
    outages.push({ from: start, to: formattedData[i].time });
  }
```

- [ ] **Step 2: Render the band, the p95 line and the outage shading**

Inside `<AreaChart>`, before the existing `<Area dataKey="latency">`:

```tsx
            {outages.map((outage, i) => (
              <ReferenceArea
                key={i}
                x1={outage.from}
                x2={outage.to}
                fill="#ffb4ab"
                fillOpacity={0.12}
                strokeOpacity={0}
              />
            ))}
            <Area
              type="monotone"
              dataKey="band"
              stroke="none"
              fill="#2665fd"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
```

and after it:

```tsx
            <Line
              type="monotone"
              dataKey="p95"
              stroke="#7ca3fe"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
```

Update the hardcoded Recharts hexes to the new tokens: `CartesianGrid stroke="#2a3a5c"`, `XAxis stroke="#8f9bbd"` and `axisLine={{ stroke: '#2a3a5c' }}`, `YAxis stroke="#8f9bbd"`, the gradient `stopColor="#2665fd"`, `Area stroke="#2665fd"`, `activeDot={{ r: 4, fill: '#2665fd', stroke: '#7ca3fe', strokeWidth: 2 }}`.

- [ ] **Step 3: Extend the tooltip and fix its copy**

Inside the tooltip body, after the latency line, add:

```tsx
                      {data.p95 !== null && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-300">p95</span>
                          <span className="text-brand-400 font-medium">{data.p95} ms</span>
                        </div>
                      )}
                      {data.band && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-300">range</span>
                          <span className="text-slate-100">{data.band[0]}–{data.band[1]} ms</span>
                        </div>
                      )}
```

Copy changes in this file: `Latency:` → `latency`, `Status:` → `status`, `Connection Failed` → `no response`, `Insufficient Performance Data` → `No checks in this window`, `No ping metrics collected within the selected time window.` → `Nothing was recorded between those two times. Try a wider range.`, `Response Latency (ms)` → `Response time`, `Ping duration metrics sampled across selected timeframe` → delete the subtitle entirely.

Radius: `rounded-2xl` → `rounded-lg` on the container and the empty state; `rounded-xl` → `rounded-lg` on the icon chip and tooltip. Remove `shadow-xl` and `shadow-2xl`.

- [ ] **Step 4: Put the statistics above the chart in the detail view**

In `monitor-detail-view.tsx`, compute the summary and render it. Add imports for `summarize`, `StatRow` and `TierNote`, then inside the component:

```typescript
  // The tier is a property of the window the database chose to serve, so read
  // it off the points rather than guessing from the preset.
  const tier = metrics[0]?.sourceTier ?? 'raw';
  const stats = summarize(metrics, tier);
```

and in the "Performance History" block:

```tsx
        <div className="space-y-2">
          {stats && <StatRow stats={stats} />}
          <TierNote tier={tier} />
        </div>
```

- [ ] **Step 5: Sentence-case the stat labels and fix the copy**

In `monitor-detail-view.tsx` remove `uppercase tracking-wider` from the `Interval`, `Timeout` and `Last Check` labels and rewrite them as `interval`, `timeout`, `last check`. Replace `Last Check` value with `formatRelative(monitor.lastCheckedAt)`. Copy: `Back to Monitors` → `All monitors`, `Refresh Metrics` → `Refresh`, `Performance History` → `Response time`, `Network error while fetching metrics` → `Could not load those metrics. Try again.`

Radius: `rounded-2xl` → `rounded-lg`, `rounded-xl` → `rounded-lg`. Remove `shadow-xl`.

- [ ] **Step 6: Give the share page the same treatment**

In `app/share/[token]/page.tsx`: replace the local `TIER_NOTE` constant and its markup with `<TierNote tier={shared.sourceTier as Tier} />`, add `<StatRow stats={...} />` from `summarize(metrics, shared.sourceTier as Tier)`, change `rounded-2xl` → `rounded-lg`, remove `shadow-xl`, and change `No response data was recorded in this window.` → `Nothing was recorded in this window.`

- [ ] **Step 7: Verify against seeded data**

Run: `cd src/web && npx vitest run && npx tsc --noEmit && npm run dev`
Open a monitor detail page for `checkout-api` at the 24h preset.
Expected: a shaded red band over the outage; a dashed p95 line where the tier provides one; the blue min–max envelope behind the trace; `StatRow` showing p50/p95/p99 on a raw window and only mean plus peak hourly p95 on a 7-day window.

- [ ] **Step 8: Commit**

```bash
git add src/web/components src/web/app
git commit -m "feat(ui): draw the envelope, the p95 line and the outages

An outage used to be invisible on the chart because the area simply continued
through it. Adds ReferenceArea shading over contiguous down runs, a min-max
band and a p95 line, all from columns the payload already carried.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

### Task 7: Sweep the remaining surfaces

**Files (in blast-radius order, highest first):**
`components/auth/register-form.tsx`, `components/monitors/create-monitor-form.tsx`, `components/settings/invite-list.tsx`, `components/auth/forgot-password-form.tsx`, `components/auth/login-form.tsx`, `components/auth/reset-password-form.tsx`, `components/monitors/time-range-picker.tsx`, `components/monitors/delete-monitor-modal.tsx`, `components/settings/webhook-form.tsx`, `components/monitors/save-view-button.tsx`, `components/settings/saved-view-list.tsx`, `components/settings/webhook-list.tsx`, `components/layout/sidebar.tsx`, `components/layout/header.tsx`, `app/dashboard/error.tsx`, `app/dashboard/loading.tsx`, `app/dashboard/monitors/[id]/loading.tsx`, `app/dashboard/settings/page.tsx`, `app/dashboard/monitors/new/page.tsx`, `app/layout.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing new.

This task is mechanical. Apply the same five rules to every file, then fix the copy listed below.

- [ ] **Step 1: Apply the five structural rules to each file in order**

1. **Radius** — `rounded-2xl`, `rounded-xl`, `rounded-md` all become `rounded-lg`. `rounded-full` becomes `rounded-lg` **except** on the two loading spinners (`create-monitor-form.tsx:174`, `delete-monitor-modal.tsx:80`, and the equivalent spinner spans in the four auth forms), which are genuinely circles and keep it.
2. **Elevation** — delete every `shadow-*` class and every `glow-brand` / `glow-emerald` / `glow-red` class. Do not replace them with anything.
3. **Uppercase** — delete `uppercase tracking-wider` from every field label and rewrite the label in sentence case (`Email Address` → `Email`, `Password` → `Password`, `Team / Organization Name` → `Team name`, `Monitor Name` → `Name`, `Target HTTP / HTTPS URL` → `URL`, `Check Interval (Seconds)` → `Check every`, `Request Timeout (ms)` → `Timeout`, `Provider` → `Provider`, `Destination URL` → `URL`, `Role` → `Role`, `Expires` → `Expires`, `Custom Timeframe` → `Custom range`).
4. **Destructive buttons** — `delete-monitor-modal.tsx:78`'s `bg-red-600 hover:bg-red-500 ... text-white` becomes `border border-status-down/40 bg-status-down/10 text-status-down hover:bg-status-down/20`. The design system reserves fills for the primary action.
5. **Primary restraint** — at most one `bg-brand-600` filled button per view. In `webhook-form.tsx` the provider selector uses `bg-brand-600/border-brand-500` for the selected chip: change it to `border-brand-500 bg-surface-hover text-slate-100` so the only fill on that page is the submit button.

- [ ] **Step 2: Fix the header, which claims something untrue**

In `components/layout/header.tsx`, delete the pulsing dot and the `Live System Monitoring` text entirely. It is a static decoration that reads as a live status claim. Replace the right-hand slot with an optional `meta` string the page supplies:

```typescript
export interface HeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned fact, e.g. "checked 12s ago". Omit when there isn't one. */
  meta?: string;
}
```

Render `{meta && <span className="text-xs text-slate-400">{meta}</span>}`. Remove `rounded-full`, `bg-emerald-*`, `animate-ping`, `font-mono` and `uppercase tracking-wider` from the file.

- [ ] **Step 3: Fix the settings naming inconsistency**

The sidebar labels `/dashboard/settings` as **Notifications**, but that page holds webhooks, shared views *and* team members, and `save-view-button.tsx:79` tells users to go to "Notifications → Shared views".

- `components/layout/sidebar.tsx`: nav item `Notifications` → `Settings`, and `Status Dashboard` → delete the subtitle.
- `app/dashboard/settings/page.tsx`: page title `Notifications` → `Settings`; the webhook section heading becomes `Alerts`.
- `components/monitors/save-view-button.tsx:79`: `Revoke it any time from Notifications → Shared views.` → `Revoke it any time from Settings.`

- [ ] **Step 4: Fix the remaining copy**

- `app/layout.tsx` metadata: title → `UptimeKit`, description → `Watch your HTTP endpoints and get told when one breaks.` (`High-Precision` was an unverifiable claim.)
- `app/dashboard/monitors/new/page.tsx`: title `Add New Monitor` → `Add a monitor`, subtitle `Configure new HTTP/HTTPS target health check` → delete.
- `create-monitor-form.tsx`: `Create HTTP Health Monitor` → `Add a monitor`; subtitle `Configure endpoint targets for background health checks and ping latency profiling.` → `UptimeKit will request this URL on a schedule and record how long it takes.`; button `Save & Start Monitoring` → `Add monitor`; `Back to Monitors` → `All monitors`; error `Unable to reach monitoring server. Please try again.` → `Could not save that monitor. Try again.`
- `delete-monitor-modal.tsx`: `Delete Monitor` → `Delete this monitor?`; subtitle `This action cannot be undone` → delete; button `Confirm Deletion` → `Delete monitor`.
- `login-form.tsx`: button `Sign In` → `Sign in`; error `Network error. Unable to reach authentication server.` → `Could not reach the server. Try again.`
- `register-form.tsx`: `Initialize monitoring workspace for your team` → `Create a team and start watching endpoints.`; buttons `Register Team` → `Create account`, `Join Team` → `Join team`; error `Network error. Unable to reach Supabase.` → `Could not reach the server. Try again.`
- `forgot-password-form.tsx`: button `Send Reset Link` → `Send reset link`.
- `reset-password-form.tsx`: button `Update Password` → `Update password`.
- `time-range-picker.tsx`: `Time Range:` → delete the label; `Last 1 Hour` → `1h`, `Last 24 Hours` → `24h`, `Last 7 Days` → `7d`, `Last 30 Days` → `30d`; `Apply Range` → `Apply`; `Start (From)` → `From`, `End (To)` → `To`.
- `app/dashboard/error.tsx`: `Unable to load dashboard data` → `Could not load your dashboard`; `An unexpected error occurred while communicating with backend services.` → `Something went wrong talking to the server.`; button `Try Again` → `Try again`.

Leave alone: every string in `lib/shared/validations/*` (already plain), the auth "Check your inbox" states (already in voice), and `lib/server/actions/webhooks.ts:66`'s `Test notification from UptimeKit` — that is a payload delivered to a customer's real Slack channel, not UI copy.

- [ ] **Step 5: Prove the structural rules hold everywhere**

Run:
```bash
cd src/web
grep -rn "shadow-\|glow-" app components && echo "FAIL: elevation remains" || echo "PASS: no elevation"
grep -rn "rounded-2xl\|rounded-xl\|rounded-md" app components && echo "FAIL: stray radii" || echo "PASS: radius normalized"
grep -rn "uppercase" app components && echo "REVIEW each hit" || echo "PASS: no uppercase"
grep -rn "font-mono" app components && echo "REVIEW: should be tnum instead" || echo "PASS: single typeface"
```
Expected: the first two print PASS. Any `rounded-full` hits left must be spinners only. Every `font-mono` must be gone — Inter's `tnum` replaces it.

- [ ] **Step 6: Verify**

Run: `cd src/web && npx vitest run && npx tsc --noEmit && npx next build`
Expected: tests pass, tsc clean, build succeeds with no ESLint errors.

- [ ] **Step 7: Commit**

```bash
git add src/web
git commit -m "feat(ui): sweep settings, auth, chrome and copy onto the system

Removes every shadow and glow, normalizes radius to 8px, sentence-cases all
20 inline labels, and rewrites system-voice copy. Deletes the header's
'Live System Monitoring' pulse, which was decoration claiming to be a live
status. Renames the settings nav from Notifications, which had not described
that page since it gained shared views and team members.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

### Task 8: Whole-app verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Run both suites and the build**

```bash
cd D:/Github/UptimeKit/UptimeKit && npm test
cd src/web && npx vitest run && npx tsc --noEmit && npx next build
```
Expected: root suite 91+ passing; web suite passing including `tokens`, `stats`, `sparkline` and `monitor-order`; tsc clean; build succeeds.

- [ ] **Step 2: Walk every surface at 1440px and at 400px**

With the dev server running and the seeded team signed in, open and check each of: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/dashboard/monitors`, `/dashboard/monitors/new`, a monitor detail page, `/dashboard/settings`, and a share link created from the detail page.

At 400px specifically, confirm no horizontal scrollbar appears and that monitor rows stack rather than truncating their controls.

- [ ] **Step 3: Check the quality floor**

- Tab through the monitors page and the create form: every interactive element shows the amber-free `ring-brand-500` focus ring.
- Confirm each status reads as a word, not only a colour.
- Set the OS to reduce motion and confirm the sparkline no longer animates.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A src/web
git commit -m "fix(ui): resolve issues found in the full-surface pass

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019uXnSGTMyNdwwXT57EMUdJ"
```

---

## Self-Review

**Spec coverage.** Tokens → Task 1. Typography → Task 1. Component rules (radius, elevation, buttons, inputs, cards) → Tasks 1, 5, 7. Layout: monitors list → Task 5; monitor detail → Task 6; everything else → Task 7. Information design and the tier honesty rule → Tasks 3 and 4. Copy → Tasks 5, 6, 7. Motion and floor → Tasks 1 and 8. Demo data → Task 2. Out-of-scope items are named in Global Constraints and no task touches them.

**One spec item deliberately dropped:** the spec's motion moment — "the sparkline's newest sample slides in on refresh" — is not implemented. The sparkline renders from server-provided props and has no refresh animation hook; adding one would mean introducing client state purely to animate. The `prefers-reduced-motion` guard is still in place for the spinners that do animate. Flagged rather than silently skipped.

**Placeholder scan:** no TBD, no "add error handling", no "similar to Task N". Every code step carries the actual code.

**Type consistency:** `StatusWord` (not `StatusBadge`) is used consistently from Task 4 onward, including the rename sweep in Task 4 Step 8. `summarize(metrics, tier)` has the same signature in Tasks 3, 6. `WindowStats` field names match between `stats.ts`, `StatRow` and the tests. `Tier` is defined once in `types.ts` and imported everywhere. `sparklinePath(values, width, height)` matches between the module, the component and its test.

---

# Addendum — Response time / Uptime tabs

Added mid-execution at the product owner's request: the chart gets a tab bar
switching between the latency view and an uptime view, one visible at a time,
sharing the time-range picker.

**Why this needs a migration.** `ping_logs_hourly` and `ping_logs_daily` both
carry `successful_pings` and `total_pings`, and also `p50_response_time_ms` and
`p99_response_time_ms`, and `ping_logs_daily` carries `percentile_source`.
`select_ping_tier` returns none of them. Without them an uptime series would read
a flat 100% on every rolled-up window, because `isUp` is synthesised as always
true for buckets — a confident, false number. The owner chose the fuller
migration.

**Signature change, not a body change.** `RETURNS TABLE` cannot be altered by
`CREATE OR REPLACE`; both functions must be dropped and recreated, innermost
last. `get_shared_view` calls `select_ping_tier_for_team` through a LATERAL join
but selects columns **by name**, so widening does not break it — verified by
reading, and the integration suite must prove it.

### Task 9: Widen the tier function

**Files:** `supabase/schema.sql`, `tests/integration/` (new cases)

- `select_ping_tier_for_team` and `select_ping_tier` gain `success_count INTEGER`,
  `p50_time_ms INTEGER`, `p99_time_ms INTEGER`, `percentile_source TEXT`.
- Raw branch: `success_count` is 1 when `status_code < 400` else 0; `p50`/`p99`
  are the sample itself; `percentile_source` is `'raw'`.
- Hourly branch: the stored `successful_pings`, `p50_response_time_ms`,
  `p99_response_time_ms`; `percentile_source` is `'raw'` — hourly percentiles are
  computed by `PERCENTILE_CONT` over that hour's real samples at rollup time.
- Daily branch: the stored columns, and `d.percentile_source` as recorded.
- `get_shared_view` gains the same four columns so the public chart keeps parity.
- Applied to production only after the local integration suite passes.

### Task 10: Carry the new columns, and compute uptime

**Files:** `lib/shared/types.ts`, `lib/server/data/monitors.ts`,
`lib/server/data/saved-views.ts`, `lib/shared/stats.ts`, tests

- `PingMetric` and `SharedViewPoint` gain `successCount`, `p50Ms`, `p99Ms`,
  `percentileSource`.
- `summarize` reports real percentiles on rolled-up tiers from the per-bucket
  values, and counts how many daily buckets are `'hourly_approx'` so the UI can
  say "3 of 30 days approximate" instead of suppressing the figure entirely.
- Uptime per bucket is `successCount / sampleCount`, exact on every tier.
- Closes the `font-mono` gap left in `monitor-detail-view.tsx`,
  `time-series-chart.tsx` and `app/share/[token]/page.tsx`.

### Task 11: The tab bar

**Files:** `components/monitors/time-series-chart.tsx` (or a sibling),
`components/monitors/monitor-detail-view.tsx`, `app/share/[token]/page.tsx`

- A segmented control above the chart: **Response time** | **Uptime**.
- Response time keeps the envelope, p95 line and outage shading.
- Uptime plots per-bucket percentage on a 0–100% axis, where an outage reads as
  a dip to zero rather than a shaded band.
- Both share one time range and one window; switching tabs refetches nothing.
- Selection is per-view UI state; it does not go in the URL.
