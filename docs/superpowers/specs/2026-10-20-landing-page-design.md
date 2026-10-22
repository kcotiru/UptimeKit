# Landing page design

**Date:** 2026-10-20
**Status:** approved in conversation, ready to plan

## Intent

`/` currently redirects straight to the dashboard (`src/web/app/page.tsx`), so a
signed-out visitor arriving at the bare domain is bounced through
`/dashboard/monitors` into `/login?redirect=...` by the middleware guard at
`src/web/middleware.ts:49-50`. The first thing anyone sees is a login wall.

This builds a public page at `/` whose job is to make a developer or a hiring
manager believe, in about twenty seconds, that the author built and operates a
real system.

**Audience, as decided by the owner:** showcase and portfolio first. Not a
conversion funnel. Nobody is being sold anything.

## Goals

1. A signed-out visitor to `/` sees the product, its real output, and its
   architecture, without an account and without a redirect.
2. A signed-in visitor still lands on the dashboard, exactly as today.
3. The page is visibly the same artifact as the app: same palette, same
   typography, same radii, same card treatment.
4. It survives a technical reader. The architecture and the storage model are on
   the page because that is the part worth showing.

## Non-goals

Pricing, a sign-up funnel, testimonials, customer logos, a newsletter, a blog,
analytics, a cookie banner, a sitemap, light mode, translations, and any copy
promising behaviour the app does not have today.

## Anti-goals

The page must not read as AI-generated filler. The owner named this as the
failure condition: a page that "screams something made of AI or is AI slop" is a
failure even if every other requirement is met.

Concretely banned: gradient mesh backgrounds, glow effects (`app/globals.css:39-40`
records that glow and elevation classes were deliberately removed), feature grids
built from icons in circles, headings of the "Powerful features" or "Everything
you need" family, emoji, fabricated testimonials or logos, invented metrics,
"Trusted by", and em dashes anywhere in the copy. Numbers appear only where they
are true, and every technical claim on the page must be traceable to a file in
this repository.

## Composition, as chosen by the owner

The owner reviewed three directions as rendered mockups and chose a mix:
the product shot of direction B with the composition and live data of direction C.

- **Hero text is left-aligned**, not centred, with both calls to action inline
  under the copy.
- **The live data sits beside the hero text**, in its own card, not behind it as
  a background and not below it.
- **The product shot runs full width below the hero**, bleeding off the bottom
  edge of its section.

## Sections, in order

1. **Nav.** Brand tile and wordmark, matching `components/layout/top-bar.tsx:48-53`
   so the mark is identical to the app's. Links: Docs, GitHub, Sign in.

2. **Hero.** Two columns. Left column copy, fixed by the owner:

   > # Know the moment it breaks.
   > ## And how slow it was before.
   >
   > UptimeKit checks your endpoints every 30 seconds, keeps every single
   > response time rather than a rolling average, and messages your team in
   > Slack or Discord the moment one goes down.

   Right column: a card for one endpoint showing a latency trace with a real
   outage band drawn in the `surface-alarm` token, and three figures beneath it
   (outage length, p95, 30-day uptime).

3. **Product shot.** Full width, bleeding off the bottom edge: the monitors list
   with anything broken sorted to the top.

4. **What it does.** The six capability rows from `README.md:34-41`, as a plain
   two-column list.

5. **How it works.** The architecture drawn as inline SVG rather than the
   README's ASCII art (`README.md:68-81`), followed by the three-tier storage
   strip: raw checks, then hourly rollups, then daily rollups, with the note that
   the chart asks for a window and the database answers from whichever tier can
   still see it.

6. **Footer.** GitHub, the docs pages, one line naming the stack, one line of
   attribution.

## Decisions the owner made

- Mix of directions B and C, as described under Composition.
- The existing app look, reused rather than a separate marketing style.
- Signed out sees the landing page; signed in continues to the dashboard.
- The owner will capture real screenshots, but on a separate track for the
  README; the page must not block on them.
- Metadata and an Open Graph image are in scope. A sitemap and analytics are not.

## Decisions made by the builder, flagged to the owner as the builder's own

These were presented in conversation as calls to overrule, and were not
overruled. They are the builder's, not the owner's.

1. **GitHub is the primary call to action**, Sign in is secondary, and a marked
   slot is left for a live-monitor link.

   The alternative, a "See a live monitor" link to a public saved view, decays:
   `app/share/[token]/page.tsx:14-30` forces `isUp: true`, so a shared chart
   cannot render downtime at all; the window is pinned rather than rolling
   (`components/monitors/save-view-button.tsx:7-11`); and retention eventually
   empties it, after which `get_shared_view` returns zero rows and the page
   becomes a 404. Against a portfolio audience, a link that rots is a liability.
   Adding one later, given a token, is a one-line change.

2. **The product shot is an HTML replica of the monitors list, not an image.**
   Built from the real tokens, it cannot 404, it stays sharp at any resolution,
   and the page is complete without waiting on screenshots. The endpoints shown
   are plainly examples. Swapping in a real PNG later replaces one element.

## Constraints

- **Dark only.** `dark` is hardcoded on `<html>` at `app/layout.tsx:22` and
  nothing in the app uses `dark:` variants.
- **Palette strictly from `tailwind.config.js`.** `brand-400` for text,
  `brand-500` for fill. Exactly one filled brand button on the page, per the
  "use the primary color sparingly" rule in `docs/design-system.md`.
- **No new colours.** `tests/tokens.test.ts` asserts contrast ratios against that
  config and must stay green.
- **Healthy is grey.** `status.up` is `#a1a1a1`, and the comment in
  `tailwind.config.js` says it is colourless on purpose: "healthy is not an
  event." The mockups the owner reviewed drew `up` in green, which was wrong
  about the house style. The page follows the config: grey for `up`, `#ffd285`
  for `degraded`, `#ff6166` for `down`.
- **No new dependencies.** There is no animation library in `src/web/package.json`
  and none is to be added. Any motion is CSS, and `app/globals.css:42-49` already
  disables motion under `prefers-reduced-motion`.
- **Zero client JavaScript on this page.** Nothing on it is interactive, so no
  component it renders may carry `'use client'`.
- **The page must stay static.** It may not call `supabaseServer()`,
  `getSessionClaims()`, `getSessionUser()` or `cookies()`, directly or through a
  component, since any of those makes the route dynamic.
- Cards reuse the existing pattern `bg-surface border border-surface-border
  rounded-lg p-6` seen at `app/share/[token]/page.tsx:59`. 8px radii, no elevation.
- The web suite is 135 tests today and must stay green.

## What is left to the builder

- The exact JSX decomposition, within the file structure the plan fixes.
- The SVG path data for the latency trace and the architecture diagram, and the
  example endpoint names and figures in the replica, subject to the "numbers only
  where true" rule: figures shown inside an obviously illustrative card are
  example data and must read as such.
- Copy for sections 4, 5 and 6, drawn from `README.md` rather than written fresh.
  Only the hero copy is fixed above.
- Responsive behaviour. The hero collapses to one column on narrow viewports;
  the breakpoint is the builder's call.

## Afterwards

`README.md:220` and `docs/known-issues.md:52` both list "No landing page" as an
open item. Both lines go in the same change.
