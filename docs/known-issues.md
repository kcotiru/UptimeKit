# Known issues

The short list lives in the [README](../README.md). This is the detail.

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

## Windows longer than 7 days mix tiers

A detail window longer than 7 days takes its peaks only from buckets older than
7 days, while mean, uptime and sample count include the newer raw points. The
UI does not say so. A non-goal of the metrics work, not an oversight.

## Webhook delivery accepts any HTTP response

`notification-processor.ts` treats any HTTP response as delivered, while the
Test button (`actions/webhooks.ts`) requires a 2xx. A non-goal of the metrics
work, not an oversight.

## Dead monitor settings

`monitors.expected_status`, `monitors.http_method` and the `expectedStatus`
field on `PingJobPayload` are stored or passed but read by nobody.
`expected_status` was left in place rather than dropped, because dropping a
column is a destructive migration with no benefit. The payload field stays
because jobs already enqueued in Redis carry it and nothing validates it.

## A degraded row does not name its cause

The worker classifies `degraded` for a 3xx, a followed redirect or a response
slower than `DEGRADED_THRESHOLD_MS`, but writes `error_message` only for
`down`. A monitor whose URL redirects therefore reads `degraded` on every check
with the row stored as a 200 and a null message, so the dashboard shows the
alarm border and the word `degraded` with no stated reason, and nothing in the
stored data recovers which of the three causes it was.

**A deliberate deferral, not an oversight.** Storing the reason means either a
new column on the hottest-written table or deriving it on read. Marked with a
`ponytail:` comment beside the classifier in
`src/worker/processors/ping-processor.ts`.

**Fix:** carry the reason on the ping row, or derive it from `redirected` plus
the status code.

## Recovery into degraded notifies as "recovered"

Any non-down verdict now resolves an open incident, `degraded` included. The
resolve path enqueues `notify-up` with `status: 'up'` and
`cause: 'Monitor recovered'`, which renders as "Monitor Recovered" for Slack
and Discord and as `monitor.up` for a generic webhook, while the dashboard
badge for that same monitor reads `degraded`. A monitor that goes down and then
starts redirecting is announced as recovered and displayed as degraded at the
same time.

**Deliberate, and already commented in the code** (the resolve branch in
`src/worker/processors/ping-processor.ts`): widening the resolve condition was
the point, and wording the alert from the verdict is notification-payload
scope. The gap is only that this list did not say so.

**Fix:** derive the notification's status and cause from
`executionResult.status` instead of hardcoding `up`.

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

Note that redirect-following is now load-bearing for a user-visible state: a
redirect is what [docs/setup.md](setup.md#simulating-monitor-states)
recommends for reproducing `degraded` at default settings, so the hop described
here is on the path the setup recipe asks you to exercise.

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

# Resolved on the metrics-correctness branch

These are fixed. They are kept because they record analysis that corrects what
the original entries claimed, not as a changelog.

## What "success" means

Every layer now agrees on down versus not-down, drawing the line at a status
of `>= 400` or no response at all. A stored row alone is enough to recover
that bit, though no finer: a 200 with a null `error_message` could have been
`up` or `degraded`. There were five independent definitions of success: the
worker classifier, the hourly rollup SQL, the raw-tier SQL in
`select_ping_tier_for_team`, and two in `monitors.ts`. The worker was the only
outlier: it compared the status code to the monitor's `expected_status`, while
the other four counted a non-null status below 400 (the hourly rollup also
requires `>= 200`). The dashboard badge is not a sixth: it renders
`monitors.status`, which is the worker's verdict, so it has no predicate of its
own.

The old failure mode was not a permanent redirect. The worker uses undici's
`fetch` with no `redirect` option, which defaults to `follow`, so a redirect
carrying a `Location` is followed and only the final status is stored. The
realistic trigger was a `204`: `expected_status` defaulted to 200 and could not
be changed from the UI, so the worker called a 204 `down` while every other
layer counted it a success. It is now a 2xx, so `up`.

The worker now classifies by band (`down` for an error, a null status or
`>= 400`; `degraded` for a 3xx, a redirected response or a slow one; `up`
otherwise) and writes `error_message` only for `down`.

An earlier plan was to add a boolean verdict column for everyone to read.
Dropped: the four non-worker predicates already agreed, so the column would have been a third
representation of a settled verdict, plus a migration and a backfill.

The hourly predicate (`>= 200 AND < 400`, `rollup-processor.ts`) and the
raw-tier function `select_ping_tier_for_team` (`< 400`, `schema.sql`) read differently but are equivalent
for any status undici can return as a final status, so the wording difference
is not a bug.

## Recent-metrics reporting on thin windows

The list view used to report the single most recent sample in the slots
labelled p50 and p95. A single sample is not a percentile. The detail page had
the same defect, softened only by printing `samples N`. A check interval of 3
hours or more triggered it permanently, not only while a monitor was young.

Window percentiles are now withheld unless enough samples back them (2, 20 and
100 for p50, p95 and p99; `MIN_SAMPLES` in `src/web/lib/shared/stats.ts`), and a
peak skips buckets that fall short individually. A daily bucket built from
hourly approximations never yields a peak p99. The list shows `mean <n>ms` when
a p50 is withheld, and the chart withholds a bucket's p95 below 20 samples.

# To-do

- [ ] **Theme and Timezone** in the account menu are visible but disabled.
- [ ] **Email is Supabase's built-in sender**: a few messages an hour, and
      only to addresses attached to the Supabase project. Fine for a demo. Real
      delivery is custom SMTP under Authentication → Emails, which is dashboard
      configuration, not a code change.
- [ ] **The signed-in user's role is not displayed.** Dropped from the top bar
      to make the dashboard layout zero-query; Settings already fetches `role`
      and is the free place to put it back.
