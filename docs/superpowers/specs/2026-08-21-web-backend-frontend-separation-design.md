# Web backend/frontend separation

**Date:** 2026-08-21
**Status:** Approved for planning
**Scope:** `src/web` only. The worker (`src/worker`), shared code (`src/shared`), and the database schema are untouched.

## Problem

The separation between server and browser code in `src/web` holds in practice but is invisible and unenforced.

Verified state at time of writing:

- **No violations exist.** No client component imports `lib/supabase.ts`, `lib/monitors.ts`, or `lib/webhooks.ts`. Client components import only `lib/types`, `lib/utils`, and `lib/validations/*`, all genuinely isomorphic.
- **Nothing enforces that.** The `server-only` package is not installed. `lib/` is a flat grab bag in which `supabase.ts` — which constructs a service-role client that bypasses every RLS policy — sits as a peer to `utils.ts`, which client components import freely. One wrong import ships a service-role key to the browser.
- **Data functions are welded to Next.** `listMonitors()`, `getMonitor()`, `getMetrics()`, and the webhook equivalents call `supabaseServer()` internally, which reaches for `next/headers`. They cannot be unit-tested without Next, and cannot be lifted out of the app.
- **A transport shim duplicates the data path.** Server Components call `lib/*` directly; client components reach the same functions over HTTP via `app/api/v1/*`. Each of those handlers is roughly ten lines of parse-call-wrap.
- **`lib/` depends on `components/`.** `lib/utils.ts:3` imports `TimeRangePreset` from `components/monitors/time-range-picker.tsx`, a client component. The layering is inverted: a shared module holds a module edge into the UI tree.
- **Three handlers have no consumer at all:** `GET /api/v1/monitors`, `GET /api/v1/monitors/[id]`, and `GET /api/v1/webhooks`. Server Components bypass them.

## Goals

1. **Prevent server/secret leaks.** Importing server code into a client component must fail the build, not silently bundle.
2. **Navigability.** The tree itself should show which code runs where, without reading imports or hunting for `'use client'`.
3. **Testability.** Data functions must be unit-testable without Next, React, or a network.
4. **Prepare for extraction.** The data layer should be liftable into a standalone service later without rewriting it.

## Non-goals

- No separate deployable. One Next app, as today.
- No change to the database schema, RLS policies, or the worker.
- No visual or UX redesign. The dashboard should look and behave identically.
- No Next 14 → 15 upgrade, and no change to the vitest version split between packages.

## Target architecture

```
src/web/
  app/                     transport: pages + api/auth/* only
  components/              frontend (unchanged location)
  lib/
    server/
      actions/             'use server' adapters — Next-coupled
      data/                pure data functions — zero Next imports
      supabase.ts          client factories (request-scoped + admin)
    shared/                types, validations, utils — isomorphic
```

There is deliberately **no `lib/client/` layer**: nothing in `lib/` is browser-only. `utils.ts` (`cn`, `formatDate`, `calculateTimestamps`) is imported by both client components and the unmarked server components `monitor-card.tsx` and `status-badge.tsx`, so it is isomorphic and belongs in `shared/`. Creating an empty `client/` tier to look symmetrical would be structure for its own sake.

### Layer contracts

| Layer | May import | Must not import | Marked |
|---|---|---|---|
| `lib/server/data` | `lib/shared`, `@supabase/supabase-js` types | anything from `next/*`, `components/` | `import 'server-only'` |
| `lib/server/actions` | `lib/server/data`, `lib/shared`, `next/cache`, `next/headers` | `components/` | `'use server'` + `server-only` |
| `lib/shared` | third-party only | `next/*`, `lib/server`, `components/` | — |
| `components/` | `lib/shared`, `lib/server/actions` | `lib/server/data`, `lib/server/supabase` | `'use client'` where interactive |

`components/` may import from `lib/server/actions` — that is the whole point of Server Actions; Next replaces the import with an RPC stub at build time and the body never reaches the browser.

### Fixing the inverted dependency

`TimeRangePreset` moves from `components/monitors/time-range-picker.tsx` into `lib/shared/types.ts`; the component imports it from there instead. Without this, `lib/shared` would violate its own contract on day one by importing from `components/`. This is a prerequisite for step 1, not an optional cleanup.

### Naming decision

`lib/shared/` is used despite the repo already having `src/shared/` (worker↔web shared code). The parent path disambiguates: `src/shared` is cross-package, `src/web/lib/shared` is web-internal isomorphic. Rejected `lib/common/` and `lib/isomorphic/` as less conventional.

## Dependency injection

Data functions take their client as a parameter:

```ts
// before
export async function listMonitors(): Promise<Monitor[]> {
  const { data, error } = await supabaseServer().from('monitors')…
}

// after
export async function listMonitors(db: SupabaseClient): Promise<Monitor[]> {
  const { data, error } = await db.from('monitors')…
}
```

Callers pass `supabaseServer()`. This is what removes `next/headers` from the data layer, satisfying goals 3 and 4 simultaneously.

`createWebhook` currently calls `getSessionUser()` internally. It becomes `createWebhook(db, input, teamId)`; the caller resolves the session. Session handling is an app-layer concern and keeping it out is what keeps the data layer portable.

## Server Action conversion

`app/api/v1/**` is removed entirely.

| Current route | Becomes | Consumer |
|---|---|---|
| `POST /api/v1/monitors` | `createMonitorAction` | create-monitor-form |
| `DELETE /api/v1/monitors/[id]` | `deleteMonitorAction` | monitor-list |
| `GET /api/v1/monitors/[id]/metrics` | `fetchMetricsAction` | monitor-detail-view |
| `POST /api/v1/webhooks` | `createWebhookAction` | webhook-form |
| `DELETE /api/v1/webhooks/[id]` | `deleteWebhookAction` | webhook-list |
| `POST /api/v1/webhooks/[id]/test` | `testWebhookAction` | webhook-list |
| `GET /api/v1/monitors` | deleted | none |
| `GET /api/v1/monitors/[id]` | deleted | none |
| `GET /api/v1/webhooks` | deleted | none |

`/api/auth/{login,register,logout}` **stay as route handlers.** They are convertible, but they establish session cookies and carry two recent verified fixes (the open-redirect guard and the `getClaims()` latency change). Converting them adds lockout risk for no structural gain.

### Error contract

Actions return `{ ok: true, data }` or `{ ok: false, error: string }` rather than throwing. Client components currently branch on `res.ok` and read `data.error`; each of the six call sites must be rewritten to the new shape and its error path re-checked by hand.

### Metrics caveat

`fetchMetricsAction` trades an idiomatic HTTP GET for RPC. Acceptable because the call is a user-triggered refetch on preset change with no caching today, but it is the one conversion that loses HTTP semantics.

## Enforcement

- Install `server-only`. Every file under `lib/server/` imports it. A client-side import becomes a build error.
- ESLint `no-restricted-imports` override on `components/**` blocking `@/lib/server/data` and `@/lib/server/supabase` (but allowing `@/lib/server/actions`), for feedback faster than a build.

`server-only` is the guarantee; ESLint is the ergonomics.

## Middleware consequence

With `app/api/v1/**` gone, the `/api/v1/:path*` matcher entry and the JSON-401 branch in `middleware.ts` guard nothing and are removed. Server Action POSTs target the page URL, already covered by `/dashboard/:path*`.

A comment stays at the matcher explaining that any future `/api/*` route must be re-added to the matcher and given the 401 branch, so the protection is not silently lost.

## Testing

**New:** unit tests for `lib/server/data/*` with a stubbed Supabase client — the payoff of injection. Cover the query shape (correct table, correct filters), the soft-delete path, and error propagation.

**New:** unit tests for `lib/server/actions/*`, called directly with a stubbed client, asserting the `{ ok, error }` contract including the failure branch.

**Existing, must stay green:** the 17 web tests. Their imports of `../lib/monitors` and `../lib/webhooks` change path; the mapper and schema assertions themselves must not change.

**Final gate:**
- 33 worker tests, 17+ web tests
- `tsc --noEmit` clean in both packages
- `next build` succeeds
- Browser: login → dashboard → settings; create and delete a monitor; create, test, and delete a webhook
- Latency re-measured to confirm no regression against the recorded baseline (`/login` 5–20 ms, `/dashboard/monitors` 45–85 ms)

## Migration sequence

Each step verified green before the next. No big-bang swap.

1. Move `TimeRangePreset` into `lib/shared/types.ts`; move `types`, `validations`, `utils` into `lib/shared/`; update imports.
2. Move server modules to `lib/server/data/` + `supabase.ts`; add `server-only`; update imports.
3. Inject the client parameter, one function at a time.
4. Add `lib/server/actions/`, convert one route per step, deleting each route handler as its action lands and its component is rewritten.
5. Delete the three consumerless GET handlers.
6. Remove the middleware `/api/v1` matcher entry and 401 branch.
7. Add the ESLint rule.
8. Add data and action tests.

## Risks

- **Churn on freshly verified code.** The webhook feature and the login path were built and verified days ago; this touches both. Mitigated by incremental steps and the browser gate.
- **Error-path regressions.** Six components move from HTTP status codes to returned values. This is the most likely place for a silent bug, and each needs manual browser confirmation, not just a passing build.
- **Server Action + middleware interaction.** Action POSTs hitting the page URL pass through middleware; step 4 must confirm an expired session degrades sensibly rather than producing an opaque failure.
- **Losing the API surface.** If an external consumer for `/api/v1` is ever wanted, it must be rebuilt. Accepted: nothing consumes it today, and the `docs/openapi.yaml` that once described it was already deleted.
