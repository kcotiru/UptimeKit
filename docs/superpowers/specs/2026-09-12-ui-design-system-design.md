# UptimeKit UI: DevFocus Dark

Design spec for the visual identity and information design pass over the web
dashboard. The design system itself lives in `docs/design-system.md` and is the
authority on the five base tokens; this document records how it is applied to
this product, what it does not cover, and what had to be derived to fill those
gaps.

## Why

The dashboard works and looks templated. Three problems, in order of how much
they cost:

1. **A down monitor looks identical to a healthy one.** The monitors page is a
   three-across grid of equal-weight cards. Status is a small pill. The page
   cannot answer "is anything broken" without reading every card.
2. **Data that is already fetched is thrown away.** `select_ping_tier` returns
   `min_time_ms`, `max_time_ms`, `p95_time_ms` and `sample_count` on every
   request. `toPingMetric` discards all four. The chart draws one flat latency
   line, and an outage is invisible on it — the area simply continues.
3. **No typeface is loaded.** `globals.css` sets Inter's `cv02/cv03/cv04`
   character-variant features, so Inter was always intended, but no font is
   ever requested. The app renders in the system stack.

## Decisions

| Decision | Choice |
| --- | --- |
| Scope | Visual identity **and** information design |
| Design system | DevFocus Dark, as given in `docs/design-system.md` |
| Demo data | Seed script, pointed at `DATABASE_TEST_URL` |
| Landing page | None — `/` keeps redirecting to the dashboard |
| New routes | None |
| Theme | Dark only |

## Tokens

### Base — from `docs/design-system.md`

Contrast measured against surface `#0b1326` using the WCAG relative-luminance
formula. The design system asks for 4:1; this spec holds body text to **4.5:1**,
the AA threshold, which every text token clears anyway.

| Token | Hex | Ratio | Permitted use |
| --- | --- | --- | --- |
| `surface` | `#0b1326` | — | Page background |
| `on-surface` | `#dae2fd` | 14.3:1 | Primary text |
| `error` | `#ffb4ab` | 10.9:1 | Error text, destructive borders, `down` status |
| `primary` | `#2665fd` | 3.84:1 | **Fills, borders, active states only — never text on surface** |
| `secondary` | `#475569` | 2.44:1 | **Structure only — chips, dividers, disabled. Never text** |

White on `primary` measures 4.8:1, so button labels on a primary fill are pure
white, not `on-surface` (which measures 3.73:1 against it and fails).

### Derived

The base palette has no token for link text, secondary text, or monitor status.
These are derived from inside the system rather than introducing new hues:
`primary-light` is `primary`'s exact hue (222°) lightened, and the status set
sits in the same light-tone band as `error` so the three read as siblings.

| Token | Hex | Ratio | Use |
| --- | --- | --- | --- |
| `primary-light` | `#7CA3FE` | 7.5:1 | Link and inline-action text |
| `muted` | `#8F9BBD` | 6.7:1 | Secondary text, chart axis ticks |
| `status-up` | `#90DFBA` | 11.9:1 | The word `up`, and only that |
| `status-degraded` | `#FFD285` | 13.0:1 | The word `degraded` |
| `status-down` | `#ffb4ab` | 10.9:1 | = `error` |
| `surface-variant` | `#172340` | 1.19:1 vs surface | Card and input background |
| `outline` | `#2a3a5c` | 1.64:1 vs surface | Card borders, hairlines |
| `outline-strong` | `#475569` | 1.98:1 vs surface | = `secondary`. Input borders, chips |

**Status colour lands on the status word and nowhere else.** It does not tint
the row, the border, or the background of a healthy monitor. With eight healthy
endpoints on screen the page stays near-monochrome, which is what makes the one
unhealthy row impossible to miss. The single exception: a monitor that is not
`up` gets an `error`-toned card border, because that is the one case where the
whole row is the alarm.

`surface-variant` and `outline` are tuned so the card is legible by fill *and*
by border, as the system requires: an earlier `#111b31` measured 1.08:1 against
the page, which is no step at all. Text on the card still clears AA —
`on-surface` at 12.1:1 and `muted` at 5.6:1.

Tokens live in `tailwind.config.js` under semantic names. Not CSS custom
properties — those earn their place when a second theme exists, and there is
none.

## Typography

Inter only, loaded through `next/font/google` so it self-hosts and no
render-blocking request to a third party is introduced.

Dropping the mono family costs column alignment on numbers, which a dashboard
full of latency figures needs. That is recovered with one declaration rather
than a second font:

```css
font-feature-settings: "cv02", "cv03", "cv04", "cv11", "tnum";
```

`tnum` makes Inter's digits tabular, so latency columns align down the page and
a value changing from `99` to `100` does not reflow its row.

Scale — `12 · 13 · 15 · 19 · 24 · 32`, body 15px at 1.55. Weights 400 / 500 /
600.

Uppercase at 12px medium is permitted on **section headers only**, per the
design system. Inline field labels are sentence case. The current
`INTERVAL` / `TIMEOUT` / `LAST CHECK` labels on the detail page are field
labels, not section headers, and lose their uppercase and tracking.

## Component rules

- **Radius is 8px. Everywhere.** No exceptions, including status indicators,
  which stop being pills. The app currently mixes `rounded-lg` (8),
  `rounded-xl` (12), `rounded-2xl` (16) and `rounded-full` inside a single
  viewport, which is exactly what the system's "don't mix rounded and sharp
  corners" rule forbids.
- **No elevation.** Every `shadow-*` class is removed and the `.glow-emerald`,
  `.glow-red` and `.glow-brand` utilities are deleted from `globals.css`.
  Separation comes from `outline` against `surface-variant` against `surface`.
- **Buttons.** One primary fill per view, maximum — the system's "use the
  primary color sparingly" rule read literally. Everything else is a bordered
  button on `surface-variant`. Destructive actions use `error` as text and
  border on a tinted background, never as a fill.
- **Inputs.** 1px `outline-strong` border on `surface-variant`, 8px radius,
  `primary` border on focus plus a visible focus ring.
- **Cards.** `surface-variant` background, 1px `outline` border, 8px radius, no
  shadow.

## Layout

### Monitors list

The three-across card grid becomes a single-column stack of full-width cards,
one monitor per row. Denser, and it gives the design somewhere to put rank.

**Anything not `up` sorts to the top** and carries an `error`-toned border.

```
 Monitors                                     [ + Add monitor ]
 8 endpoints, 1 down                            checked 12s ago

 ┌───────────────────────────────────────────────────────────┐
 │ checkout-api                                         down │  error border
 │ checkout.acme.com/health                                  │
 │ ▁▂▁▃█▁▁▁▁▁▁▁▁     HTTP 503   99.2% today      4m 12s      │
 └───────────────────────────────────────────────────────────┘
 ┌───────────────────────────────────────────────────────────┐
 │ api                                                    up │
 │ api.acme.com/health                                       │
 │ ▁▂▃▂▁▁▂▅▃▂▁▂▁▃▂▁   p50 142ms  p95 318ms   99.94% today    │
 └───────────────────────────────────────────────────────────┘
```

Each row carries a sparkline of recent samples, the window statistics, uptime
for the day, and — when the monitor is down — the HTTP status and how long it
has been down. All of it is in the payload the page already fetches.

### Monitor detail

The chart becomes the hero and gains three things the data already supports:

- a **min–max envelope** behind the trace, from `min_time_ms` / `max_time_ms`
- a **p95 line** above the mean trace, from `p95_time_ms`
- **outage shading** on the time axis wherever `isUp` is false

A statistics row sits above the chart. The existing `TIER_NOTE` pattern from the
share page moves into a shared component and appears under it.

### Everything else

Settings, the four auth forms, the create-monitor form and the public share page
are re-tokenised and re-copied to match, without structural change. The share
page additionally picks up the statistics row, since it is the surface a
stranger sees.

The share path has the same discard bug twice over: `get_shared_view` returns
`min_time_ms` and `max_time_ms`, `toSharedView` types both on its row interface,
and then drops them when building `points`. `SharedViewPoint` gains `minMs` and
`maxMs` so the public chart can draw the same envelope as the private one. This
is a TypeScript-only change — the SQL already returns the columns.

`app/share/[token]/page.tsx` hand-builds `PingMetric`-shaped objects rather than
going through a mapper, supplying `statusCode: null` and `isUp: true` as
literals. Widening `PingMetric` breaks that object, so it converts to a named
mapper alongside the widened type.

## Information design: say only what the data supports

Window statistics are computed in a new `lib/shared/stats.ts` of pure functions,
and **labelled by what the tier can actually support**. The three tiers are not
equally trustworthy, and the difference is documented in the schema itself:

| Tier | `response_time_ms` | `p95_time_ms` | What the UI may claim |
| --- | --- | --- | --- |
| `raw` | the sample | n/a — samples are present | Exact `p50` / `p95` / `p99`, computed here |
| `hourly` | mean of the hour | `PERCENTILE_CONT(0.95)` over that hour's raw rows — **exact** | Per-bucket p95 plotted faithfully; window summary is the mean and the *peak hourly p95*, never a "window p95" |
| `daily` | ping-count-weighted mean of hourly means | **exact or approximate, and the UI cannot tell which** | Mean only. p95 shown as approximate, never as a percentile |

The daily case is the sharp one. `ping_logs_daily.percentile_source` records
whether that day's p95 was recomputed from surviving raw rows (`'raw'`) or
derived as a percentile of hourly percentiles (`'hourly_approx'`), and the
schema's own comment on that column says the approximate form's "error is
unbounded". **Neither `select_ping_tier` nor `get_shared_view` returns
`percentile_source`**, so by the time a number reaches React its provenance is
gone. Rendering it as "p95" would be asserting a precision the payload cannot
back.

Within this pass's no-SQL-changes boundary, the resolution is to label it: on
the daily tier the statistics row shows the mean and marks percentiles
approximate, which is what the existing `TIER_NOTE` on the share page already
tells users. Returning `percentile_source` so the UI could mark exact days
precisely is a schema change and therefore a separate decision, recorded in
Follow-ups.

Collapsing per-bucket percentiles into a single window percentile is not
possible for either rolled-up tier and is not attempted.

`stats.ts` is pure and gets a unit test — the one runnable check this work
leaves behind.

## Copy

System voice to user voice. Sentence case, active verbs, named for what a user
understands.

| Now | Becomes |
| --- | --- |
| `Monitors & Endpoints` | `Monitors` |
| `Active HTTP target checks (3 configured)` | `8 endpoints, 1 down` |
| `Insufficient Performance Data` | `No checks recorded in this window.` |
| `Operational` / `Offline` / `Pending Check` | `up` / `down` / `not checked yet` |
| `Metrics ›` | `History` |
| `Create Monitor Now` | `Add your first monitor` |

The animated `LIVE SYSTEM MONITORING` indicator in the header is deleted. It is
a decorative pulse claiming to report a live system; it is replaced by the fact
it was imitating — `checked 12s ago`, from real data.

Trailing `→` and `›` in link text, and middle-dot-joined meta strings, are
removed wherever they appear.

## Motion and the quality floor

- One motion moment: the sparkline's newest sample slides in on refresh.
  Nothing else animates except focus and hover state changes.
- `prefers-reduced-motion: reduce` removes it.
- Visible focus ring on every interactive element, `primary` at 2px.
- **Status is always carried by a word**, never by colour alone. This is what
  makes the palette safe for colour-blind users without a special case.
- Responsive to 400px. Full-width rows stack rather than truncate; the URL
  truncates with an accessible title.

## Out of scope

No new routes. The `incidents` table stays unread — outage *history* is a
surface of its own and this pass does not add surfaces. No fleet overview page,
no landing page, no light theme, no component library dependency. No SQL
changes: everything here is already in the response payload.

## Follow-ups, not in this pass

- **Expose `percentile_source`.** Adding it to `select_ping_tier` and
  `get_shared_view` would let the daily tier distinguish an exact p95 from an
  unbounded-error one instead of labelling the whole tier approximate. It is a
  schema change and a second production migration, so it is the user's call.
- **Read the `incidents` table.** Outage history deserves its own surface and
  this pass adds no surfaces.
- **Light theme.** Would justify moving tokens from `tailwind.config.js` to CSS
  custom properties. Not before.

## Verification

- `npx tsc --noEmit` clean and `npx next build` succeeds.
- `npm test` in `src/web` passes, including the new `stats.test.ts`.
- Every token pair in the tables above re-measured programmatically, not
  asserted — the check is part of the work, not a claim about it.
- The seeded demo team renders: a down monitor sorted to the top, a chart with a
  visible outage band, and percentile labels that change when the window crosses
  a tier boundary.
