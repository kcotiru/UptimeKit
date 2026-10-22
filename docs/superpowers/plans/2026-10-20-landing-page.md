# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redirect at `/` with a public, static landing page, while a signed-in visitor still goes straight to the dashboard.

**Architecture:** `src/web/app/page.tsx` becomes a synchronous Server Component with no data access, so the route stays prerendered and carries no client JavaScript. Three presentational components under `components/landing/` hold the markup-heavy pieces. The signed-in redirect moves into the existing middleware, which already has the branch and only needs `/` added to it.

**Tech Stack:** Next.js 14.2 App Router, React 18, Tailwind 3.4, vitest 4.1.10 (`environment: 'node'`), `react-dom/server` for render assertions, `next/og` for the Open Graph image. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-landing-page-design.md`

**Method:** test-driven, per `superpowers:test-driven-development`. No production code without a failing test first. The Test Plan below is the contract: every test states the production change that makes it fail, and no test is accepted until that failure has been observed.

## Global Constraints

- **Never run `git commit`.** The repository owner commits everything. Leave finished work uncommitted and report what is ready. This overrides any commit step in any skill.
- **No new dependencies.** Nothing may be added to `src/web/package.json`.
- **No new colours.** Use only tokens already in `src/web/tailwind.config.js`. `tests/tokens.test.ts` asserts contrast against that file and must stay green.
- `brand-400` (`#a5b4fc`) is the only text-safe brand tint. `brand-500`/`brand-600` (`#4f46e5`) are fills only, never text.
- **Exactly one filled brand button on the whole page**, per `docs/design-system.md` ("use the primary color sparingly").
- `status.up` is `#a1a1a1`, deliberately colourless. Healthy is grey, not green. `status.degraded` is `#ffd285`, `status.down` is `#ff6166`.
- Card pattern: `bg-surface border border-surface-border rounded-lg`, 8px radii, no elevation, no glow.
- **No `'use client'`** in `app/page.tsx` or anything under `components/landing/`.
- **The page must stay static.** No `cookies()`, `supabaseServer()`, `getSessionClaims()` or `getSessionUser()`, directly or transitively. `.eslintrc.json:3-19` already blocks `components/**` from importing `@/lib/server/data/*` and `@/lib/server/supabase`.
- **No em dashes** anywhere: copy, comments, reports. A comma, a colon, parentheses or two sentences instead.
- **Anti-slop ban list**, from the spec: no gradient mesh, no glow, no icons in circles as a feature grid, no "Powerful features" or "Everything you need" headings, no emoji, no fabricated testimonials or logos, no invented metrics, no "Trusted by". Every technical claim must be traceable to a file in this repository.
- Hero copy is fixed by the owner and must be used verbatim. See T2.

**Commands** (run from `src/web`):

| | |
| --- | --- |
| Whole suite | `npm test` |
| One file | `npx vitest run tests/landing.test.ts` |
| One test | `npx vitest run tests/landing.test.ts -t "<name>"` |
| Lint | `npm run lint` |
| Typecheck | `npx tsc --noEmit` (no script exists; this is the command) |
| Build | `npm run build` |

Baseline before any change: **16 files, 135 tests, 0 skipped, about 3s**. Every vitest run prints a harmless "ESM syntax in a file loaded as CommonJS" warning; ignore it.

---

## Test Plan

Two kinds of test here, and they are held to different standards.

**Behaviour tests (B)** fail before the code exists. Write it, run it, watch it fail for the stated reason, then implement. Standard red-green.

**Invariant guards (G)** pass the moment they are written, because the thing they forbid is not there yet. They are still worth having: they are what stops a later task, or a later change by anyone, from breaking a rule the owner cares about. A guard is only accepted once its **proof mutation** has been applied, the guard watched to fail, and the mutation reverted. A guard whose failure nobody has seen is decoration.

Record each observed failure message in the task report.

### Harness notes

No test in this repository has ever rendered a component, and there is no jsdom, no happy-dom and no testing-library. `environment: 'node'` with `react-dom` already a dependency means `renderToStaticMarkup` is the available tool, and it is enough because this page is synchronous and has no data access.

`tests/landing.test.ts` uses a helper rather than rendering at module scope, so a throwing page produces a clean per-test failure instead of a file-level collection error:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import LandingPage from '../app/page';

const root = resolve(__dirname, '..');
const render = () => renderToStaticMarkup(createElement(LandingPage));
const landingFiles = () =>
  readdirSync(resolve(root, 'components/landing'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `components/landing/${f}`);
```

`tests/middleware.test.ts` mocks `@supabase/ssr` with the pattern already in `tests/get-session-user.test.ts:6-25` (`vi.hoisted` spies, `vi.mock`, dynamic `await import` inside the test) and drives the real middleware with a real `NextRequest`:

```ts
const run = async (pathname: string, claims: Record<string, unknown> | null) => {
  getClaims.mockResolvedValue({ data: claims ? { claims } : null });
  const { middleware } = await import('../middleware');
  return middleware(new NextRequest(new URL(`http://localhost:3001${pathname}`)));
};
```

### `tests/middleware.test.ts`

| id | kind | test name | pins | proof: the change that makes it fail |
| --- | --- | --- | --- | --- |
| M1 | B | `sends a signed-in visitor from / to the dashboard` | 307 and `location` pathname `/dashboard/monitors` | before implementation: `/` is not in the branch, so the response is 200. Afterwards: drop `pathname === '/'` from `middleware.ts:63` |
| M2 | B | `matches /` | `config.matcher` contains `'/'` | before implementation the matcher has 5 entries and none is `/`. Afterwards: remove `'/'` from `middleware.ts:84` |
| M3 | G | `lets a signed-out visitor see /` | no `location` header, status 200 | change the guard at `middleware.ts:49` to `pathname.startsWith('/dashboard') \|\| pathname === '/'` |
| M4 | G | `still guards the dashboard while signed out` | 307 to `/login`, `redirect` param `/dashboard/monitors` | delete the branch at `middleware.ts:49-51` |

M3 matters more than it looks: the whole point of the change is that `/` becomes reachable, and the easiest way to get the matcher edit wrong is to also catch `/` in the signed-out guard, which would bounce every visitor to `/login` exactly as today.

### `tests/landing.test.ts`

| id | kind | test name | pins | proof: the change that makes it fail |
| --- | --- | --- | --- | --- |
| **T1** | | | | |
| L1 | B | `renders a page instead of redirecting` | render succeeds, output over 1000 chars, contains `Know the moment it breaks` | before implementation `redirect()` throws, so `render()` throws. Afterwards: restore the `redirect()` call |
| L2 | B | `renders nothing that needs a session` | no `'use client'`, `cookies(`, `supabaseServer` or `getSession(Claims\|User)` in `app/page.tsx` or any `components/landing/*.tsx`, and that directory is not empty | before implementation `components/landing` does not exist, so `readdirSync` throws. Afterwards: add `'use client'` to any landing component |
| **T2** | | | | |
| L3 | B | `uses the hero copy the owner fixed` | all three of `Know the moment it breaks`, `And how slow it was before`, `checks your endpoints every 30 seconds` | reword any of the three |
| L4 | B | `links to the source` | contains `github.com/kcotiru/UptimeKit` | remove the GitHub link |
| L5 | B | `fills exactly one button with the brand colour` | `html.match(/bg-brand-(500\|600)\b/g)` has length exactly 1 | before implementation there are 0. Afterwards: fill a second button, which is the realistic regression |
| L6 | B | `stacks to one column before the breakpoint` | matches `/grid-cols-1[^"]*\b(sm\|md\|lg):grid-cols-2/` | drop `grid-cols-1`, leaving the two-column grid unconditional |
| L7 | B | `draws the outage band with the alarm token` | contains `surface-alarm` | swap it for a hardcoded hex or any other red |
| L8 | B | `shows a down row and a degraded row` | contains both `down` and `degraded` | make every example row healthy, which is the lazy mistake: a preview where nothing is wrong shows nothing the product is for |
| L9 | G | `contains no em dash` | rendered HTML has no `\u2014` | put an em dash in the hero subline |
| L10 | G | `uses no green for a healthy row` | no `text-green-` or `text-emerald-` | colour an `up` row `text-emerald-400`, which is what the reviewed mockups wrongly did |
| **T3** | | | | |
| L11 | B | `lists the capabilities from the README` | contains `Watches endpoints`, `Records outages`, `Keeps teams separate` | drop a row from the list |
| L12 | B | `shows all three storage tiers` | contains `Raw checks`, `Hourly`, `Daily` | drop the daily tier, the one most easily forgotten |
| L13 | B | `draws the architecture with an accessible name` | contains `<svg`, `role="img"` and `<title` | remove the `<title>`, leaving the diagram silent to a screen reader |
| L14 | B | `footer links to the docs` | contains `docs/operations.md` | remove the docs links |
| **T4** | | | | |
| L15 | B | `describes itself for a pasted link` | `metadata.title` contains `UptimeKit`, `metadata.description` is set, `metadata.openGraph.title` is set | before implementation there is no `metadata` export. Afterwards: delete `openGraph` |
| L16 | G | `keeps the metadata free of em dashes` | `metadata.title` and `metadata.description` have no `\u2014` | put an em dash in the description |

### Not coverable by a unit test

**`/` must stay a static route.** Nothing in vitest can observe Next's rendering mode. The check is `npm run build` in T4, reading the route table for `○ /` rather than `ƒ /`. L2 is the unit-level proxy for it, catching the realistic cause (a session call) rather than the symptom.

**Visual slop.** No test can tell you whether the page reads as generated. The ban list in Global Constraints is the checklist, and the owner is the judge.

## Review Focus

Five failure modes the spec implies, each with the test that pins it.

1. **A signed-in visitor sees the landing page.** `/` is not in the matcher today, so forgetting that one line ships marketing to daily users. M1, M2.
2. **The route silently becomes dynamic.** One stray session call, in the page or any component it renders. L2, plus the build check in T4.
3. **An em dash reaches the copy.** The owner's stated failure condition. L9, L16.
4. **A second filled brand button.** Every new section is a chance to add one. L5, re-run by T3 and T4.
5. **Healthy rendered as green.** The reviewed mockups did exactly this, so it is a live risk rather than a hypothetical. L10.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/web/app/page.tsx` | The page: metadata, nav, hero copy, capability list, footer, composition. Synchronous, no data access. |
| `src/web/components/landing/latency-card.tsx` | The hero's right-hand card: one endpoint, latency trace with an outage band, three figures. |
| `src/web/components/landing/monitors-preview.tsx` | Full-width replica of the monitors list. |
| `src/web/components/landing/architecture.tsx` | Architecture diagram as inline SVG, plus the three-tier storage strip. |
| `src/web/app/opengraph-image.tsx` | Open Graph image via `next/og`. |
| `src/web/app/icon.svg` | Favicon matching the brand tile. |
| `src/web/tests/landing.test.ts` | L1 to L16. |
| `src/web/tests/middleware.test.ts` | M1 to M4. |

---

### Task 1: Routing, and a page that is not a redirect

**Files:**
- Modify: `src/web/app/page.tsx` (all 5 lines; it is currently a `redirect()`)
- Modify: `src/web/middleware.ts:63` and `:84`
- Create: `src/web/tests/middleware.test.ts`, `src/web/tests/landing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `app/page.tsx` default export `LandingPage(): JSX.Element`, synchronous, no props. Later tasks add sections inside it.

- [ ] **Step 1: Write M1 to M4**

Per the Test Plan, with the `run` helper from Harness notes.

- [ ] **Step 2: Watch M1 and M2 fail**

Run: `npx vitest run tests/middleware.test.ts`
Expected: M1 fails (status 200, no `location`), M2 fails (matcher has no `/`). M3 and M4 pass: they are guards on behaviour that already exists. Record the two failure messages.

- [ ] **Step 3: Add `/` to the signed-in branch and the matcher**

At `middleware.ts:63`, extend the condition to `user && (pathname === '/' || pathname === '/login' || pathname === '/register')`. Add `'/'` to the matcher at `:84`.

Add one comment above the matcher recording the consequence: `/` now runs `getClaims()` on every public hit, so a deploy missing `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` fails on the landing page too, not only in the app. Mark it `ponytail:` with the upgrade path (skip the Supabase client for `/` when those vars are absent) and leave it unguarded: the rest of the app is already unusable without them.

- [ ] **Step 4: Watch M1 to M4 pass, then prove the guards**

Run: `npx vitest run tests/middleware.test.ts`
Expected: 4 passed.

Then apply M3's proof mutation, confirm M3 fails, revert. Same for M4. Report both messages.

- [ ] **Step 5: Write L1 and L2**

- [ ] **Step 6: Watch them fail**

Run: `npx vitest run tests/landing.test.ts`
Expected: L1 fails because `redirect()` throws (`NEXT_REDIRECT`), L2 fails because `components/landing` does not exist. Both failures are about missing code, not typos.

- [ ] **Step 7: Replace `app/page.tsx`, minimally**

A synchronous default export `LandingPage` returning the page shell: the nav (brand tile and wordmark per `components/layout/top-bar.tsx:48-53`, links to Docs, GitHub and `/login`) and an `<h1>` carrying the fixed hero headline. Nothing else; the sections belong to T2 and T3. Create `components/landing/` with `latency-card.tsx` exporting a component that returns `null`, so L2 has a real directory to scan.

- [ ] **Step 8: Watch L1 and L2 pass**

Run: `npx vitest run tests/landing.test.ts`
Expected: 2 passed.

- [ ] **Step 9: Verify the suite, types and lint**

Run: `npm test`, then `npx tsc --noEmit`, then `npm run lint`
Expected: 135 baseline tests still pass, plus 6 new. Types and lint clean. Report any failure by name, including ones you did not cause. **Do not commit.**

---

### Task 2: Hero and product shot

**Files:**
- Modify: `src/web/app/page.tsx`
- Create: `src/web/components/landing/monitors-preview.tsx`
- Modify: `src/web/components/landing/latency-card.tsx` (the T1 stub)
- Modify: `src/web/tests/landing.test.ts`

**Interfaces:**
- Consumes: `LandingPage` from T1.
- Produces: `LatencyCard(): JSX.Element` and `MonitorsPreview(): JSX.Element`, both synchronous and taking no props. Named exports, matching the convention in `components/monitors/*`.

- [ ] **Step 1: Write L3 to L10**

- [ ] **Step 2: Watch L3 to L8 fail, and note that L9 and L10 pass**

Run: `npx vitest run tests/landing.test.ts`
Expected: L3, L4, L5, L6, L7, L8 fail. L9 and L10 pass, because there is nothing yet to violate them. That is expected and is why they carry proof mutations in Step 6.

- [ ] **Step 3: Build the hero**

Two columns in `app/page.tsx`, one column below the breakpoint. Left column, this copy verbatim:

> Know the moment it breaks.
> And how slow it was before.
>
> UptimeKit checks your endpoints every 30 seconds, keeps every single response time rather than a rolling average, and messages your team in Slack or Discord the moment one goes down.

The second line belongs to the `<h1>`, on its own line. Then both calls to action inline: **View on GitHub** as the page's single `bg-brand-600` filled button, and **Sign in** as a bordered link to `/login`. Leave a comment marking the slot for a future live-monitor link with the reason it is absent (spec, "Decisions made by the builder", point 1).

Right column: `<LatencyCard />`.

- [ ] **Step 4: Build `latency-card.tsx`**

One endpoint, a latency trace as a static inline `<svg>` `<polyline>`, an outage band filled with the `surface-alarm` token, and a three-figure strip beneath it (outage length, p95, 30-day uptime). No library and no client JavaScript. Name the endpoint so it reads as an example, and keep the figures consistent with the shape of the trace.

- [ ] **Step 5: Build `monitors-preview.tsx`**

The monitors list replica, full width, bleeding off the bottom edge of its section: a header row, then four endpoint rows with one `down`, one `degraded` and two `up`, broken sorted to the top. The down row sits on `bg-surface-alarm`. Each row carries a small `<svg>` sparkline. Status words follow `components/monitors/status-badge.tsx`: a coloured word, no pill and no dot, and `up` stays colourless.

- [ ] **Step 6: Watch L3 to L8 pass, then prove L9 and L10**

Run: `npx vitest run tests/landing.test.ts`
Expected: 10 passed.

Then apply L9's proof mutation (an em dash in the hero subline), confirm L9 fails, revert. Then L10's (`text-emerald-400` on an `up` row), confirm L10 fails, revert. Report both failure messages. A guard whose failure was not observed does not count as done.

- [ ] **Step 7: Verify the suite, types and lint**

Run: `npm test`, then `npx tsc --noEmit`, then `npm run lint`
Expected: all clean. **Do not commit.**

---

### Task 3: What it does, how it works, footer

**Files:**
- Modify: `src/web/app/page.tsx`
- Create: `src/web/components/landing/architecture.tsx`
- Modify: `src/web/tests/landing.test.ts`

**Interfaces:**
- Consumes: `LandingPage` from T1.
- Produces: `Architecture(): JSX.Element`, synchronous, no props.

- [ ] **Step 1: Write L11 to L14**

- [ ] **Step 2: Watch them fail**

Run: `npx vitest run tests/landing.test.ts`
Expected: all four fail on missing content.

- [ ] **Step 3: Write the capability section**

The six rows from `README.md:34-41` as a two-column list in `app/page.tsx`. Label and description per row. No icons in circles, no shadowed cards. Copy comes from the README; do not write fresh marketing lines.

- [ ] **Step 4: Build `architecture.tsx`**

Inline SVG of the three boxes and their arrows from `README.md:68-81` (web dashboard, Supabase Postgres, worker), carrying the two points the README makes: the web app queries as the signed-in user so row level security enforces team isolation, and the worker connects as `postgres` and bypasses it deliberately. Give the SVG `role="img"` and a `<title>`. Below it, the three-tier strip (raw checks, hourly rollups, daily rollups) and the line that the chart asks for a window and the database answers from whichever tier can still see it.

- [ ] **Step 5: Write the footer**

Links to the GitHub repository and to `docs/setup.md`, `docs/operations.md`, `docs/known-issues.md`, `docs/design-system.md`. One line naming the stack, one line of attribution. No newsletter, no social icons.

- [ ] **Step 6: Watch L11 to L14 pass**

Run: `npx vitest run tests/landing.test.ts`
Expected: 14 passed, including L5, L9 and L10 still green over the new sections.

- [ ] **Step 7: Verify the suite, types and lint**

Run: `npm test`, then `npx tsc --noEmit`, then `npm run lint`
Expected: all clean. **Do not commit.**

---

### Task 4: Metadata, icon, and closing the known issue

**Files:**
- Modify: `src/web/app/page.tsx` (add the `metadata` export)
- Create: `src/web/app/opengraph-image.tsx`, `src/web/app/icon.svg`
- Modify: `README.md:220`, `docs/known-issues.md:52`
- Modify: `src/web/tests/landing.test.ts`

**Interfaces:**
- Consumes: `LandingPage` from T1.
- Produces: `metadata: Metadata` exported from `app/page.tsx`.

- [ ] **Step 1: Write L15 and L16**

- [ ] **Step 2: Watch L15 fail**

Run: `npx vitest run tests/landing.test.ts -t "describes itself"`
Expected: fails, there is no `metadata` export. L16 passes for now.

- [ ] **Step 3: Add the `metadata` export**

`export const metadata: Metadata` in `app/page.tsx` with `title`, `description` and `openGraph`. The root layout at `app/layout.tsx:11-14` sets a default title and description; this is the page's own and overrides it. Do not edit the root layout.

- [ ] **Step 4: Watch L15 pass, then prove L16**

Run: `npx vitest run tests/landing.test.ts`
Expected: 16 passed. Then put an em dash in the description, confirm L16 fails, revert, and report the message.

- [ ] **Step 5: Add the Open Graph image**

`app/opengraph-image.tsx` using `ImageResponse` from `next/og`, which ships with Next 14, so no dependency is added. 1200x630, the brand tile and wordmark on `#121212`, the product line beneath. Export `size`, `alt` and `contentType` alongside, per the Next file convention. Use a system font stack rather than fetching Inter at build time.

- [ ] **Step 6: Add the favicon**

`app/icon.svg`: the rounded brand tile from `components/layout/top-bar.tsx:49` with the lucide `Activity` glyph path, `#4f46e5` fill and `#a5b4fc` stroke. No `public/` directory is created.

- [ ] **Step 7: Prove `/` is still static**

Run: `npm run build`
Expected: the build succeeds and the route table marks `/` static (`○`), not dynamic (`ƒ`), with `/opengraph-image` and `/icon.svg` listed. If `/` is dynamic, something reintroduced a session call: find it before continuing, and say what it was.

- [ ] **Step 8: Close the known issue**

Delete the "No landing page" line from `README.md:220` and from `docs/known-issues.md:52`. Change nothing else in either file.

- [ ] **Step 9: Final verification**

From `src/web`: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
From the repository root: `npm test`, to prove the worker suite is undisturbed.
Expected: web 135 baseline plus 20 new, worker suite unchanged, types and lint clean, build clean with `/` static. Report the numbers, every observed guard failure message, and anything that failed. **Do not commit.**
