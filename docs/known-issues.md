# Known issues

The short list lives in the [README](../README.md). This is the detail.

## Three components disagree on what "success" means

Three different definitions of a successful check are in the codebase at once:

| Component | Counts as success |
| --- | --- |
| Worker | Status code equals the monitor's expected one (default `200`) |
| Hourly rollup | `200–399` |
| Dashboard | Anything `< 400` |

A monitor returning a permanent redirect would therefore show a red `down`
badge next to `uptime 100%`: the worker calls it a failure, the rollup counts
it as a success, and both figures render on the same card.

Latent today because everything being monitored returns `200`.

**Fix:** have the worker record its own verdict as a boolean column at write
time, and have the rollup and the dashboard read that column instead of
re-deriving a verdict from the status code. One definition, written once.

## Recent-metrics reporting on the live tier

For monitors young enough that their window is served from raw pings rather
than hourly buckets, the list view reports the single most recent sample in the
slots labelled p50 and p99. The number is correct (it is a real response time),
but a single sample is not a percentile, so the label overstates it.

The detail page is unaffected; it computes window percentiles properly via
`summarize()` in `src/web/lib/shared/stats.ts`.

## Share page reports live status on a pinned window

A shared view pins a time window, but the page returns the monitor's *current*
`status` alongside it (`supabase/schema.sql`, `get_shared_view`). A link shared
during an outage will show `up` once the site recovers, next to a chart that
still shows the outage.

## `revalidatePath` calls are no-ops

Seven server actions call `revalidatePath` while every dashboard route is
`export const dynamic = 'force-dynamic'`, which means nothing is cached to
invalidate. Harmless, but misleading to read: they imply a caching strategy
that is not in place.

# To-do

- [ ] **Theme and Timezone** in the account menu are visible but disabled.
- [ ] **Email is Supabase's built-in sender**: a few messages an hour, and
      only to addresses attached to the Supabase project. Fine for a demo. Real
      delivery is custom SMTP under Authentication → Emails, which is dashboard
      configuration, not a code change.
- [ ] **The signed-in user's role is not displayed.** Dropped from the top bar
      to make the dashboard layout zero-query; Settings already fetches `role`
      and is the free place to put it back.
