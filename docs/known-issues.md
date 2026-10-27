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

## A degraded monitor renders as if it were down

`MonitorRow` (`src/web/components/monitors/monitor-row.tsx`) shows the HTTP
status code and the "down for X" label whenever `monitor.status !== 'up'`. A
degraded endpoint that answers every check with `200` therefore prints
`HTTP 200` and `down for 0s` in the error tone.

**Fix:** gate both spans on `status === 'down'`. The alarm styling on the row
itself is deliberate and should stay, since a degraded endpoint does need
attention.

## The list header counts degraded endpoints as down

`src/web/app/dashboard/monitors/page.tsx` builds "N endpoints, M down" by
counting every monitor whose status is not `up`, so one down plus one degraded
prints `2 down`. A comment there says this is deliberate ("A row alarms on
anything other than 'up' (degraded counts too), so the header count must match
that, not just 'down'"), so treat it as a wording decision to revisit rather
than an oversight.

## The worker's ping may follow a redirect to a bare IP literal

`src/worker/http/ping-client.ts` pins the resolved IP by passing a custom
`lookup` to the request, so a hostname cannot be re-resolved to a different
address after validation. A redirect whose `Location` is a bare IP literal
(for example `http://10.0.0.5/`) never calls `lookup` at all, because Node does
not resolve an address that is already an address. If redirects are followed,
that hop skips the pin and the SSRF check.

This is **inferred from reading the code and has not been executed.**

**Out of scope by the owner's scoping decision for the web-hardening work, not
an oversight.** The worker was deliberately left untouched. The web app's
equivalent path (`testWebhookAction`) was fixed by sending `redirect: 'manual'`
and treating a 3xx as a failure.

**Fix:** do not follow redirects in the ping, or re-run `SSRFValidator` on each
`Location` and pin each hop.

## The Test webhook button is open to DNS rebinding

`testWebhookAction` runs `SSRFValidator`, which resolves the host, and then
global `fetch` resolves it again. An attacker-controlled name can answer with a
public address for the first lookup and an internal one for the second, and the
response status leaks through `Destination responded N`. The worker's ping has
the same time-of-check-to-time-of-use gap.

**A deliberate deferral, not an oversight.** The Test button is admin-only and
session-gated, so the "attacker" is an admin probing their own deployment, and
the owner's threat model is a deployed portfolio with no other users. The real
fix is to replace global `fetch` with an undici dispatcher whose `lookup` pins
the IP the validator resolved. That is new scope, and the worker's ping path
(out of scope by the owner's decision, see above) has the identical gap, so
closing one and not the other would be incoherent.

**Fix:** one pinned-lookup dispatcher shared by the Test button and the worker.

## The Test webhook button ignores `SSRF_ALLOWLIST`

`testWebhookAction` builds `new SSRFValidator()` with an empty allowlist, so it
refuses an allowlisted internal host that the worker would accept. Deliberate:
honouring it would need the same env var on the web host, kept in step with
the worker's. Do not "fix" it without that trade-off in mind.

## The SSRF allowlist blocks NAT64

`64:ff9b::/96` is refused, which is correct for an SSRF guard but is the one
newly blocked range with a legitimate use: an IPv6-only host using DNS64 to
reach an IPv4-only monitoring target would stop being pingable. Not relevant to
this deployment today.

# To-do

- [ ] **Theme and Timezone** in the account menu are visible but disabled.
- [ ] **Email is Supabase's built-in sender**: a few messages an hour, and
      only to addresses attached to the Supabase project. Fine for a demo. Real
      delivery is custom SMTP under Authentication → Emails, which is dashboard
      configuration, not a code change.
- [ ] **The signed-in user's role is not displayed.** Dropped from the top bar
      to make the dashboard layout zero-query; Settings already fetches `role`
      and is the free place to put it back.
