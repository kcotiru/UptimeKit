# UptimeKit

**Is my website up? And how fast was it, really?**

UptimeKit answers both. You give it a list of web addresses to watch. It checks
each one on a schedule, around the clock, and keeps a permanent record: when it
went down, how long it stayed down, and how quickly it responded on every check
in between. When something breaks it messages your team on Slack or Discord
within seconds.

It is the same idea as Pingdom or UptimeRobot, built from scratch.

---

## Screenshots

<!-- Drop the PNGs into docs/images/ and delete this comment to publish them.
<p align="center">
  <img src="docs/images/monitors.png" alt="The monitors list" width="800">
  <br><em>The monitors list — anything broken sorts to the top.</em>
</p>
<p align="center">
  <img src="docs/images/detail.png" alt="A single monitor's response-time chart" width="800">
  <br><em>One monitor: response time over 24 hours, outages shaded in red.</em>
</p>
-->

> _Screenshots pending — see `docs/images/`._

---

## What it does

|  | |
| --- | --- |
| **Watches endpoints** | Any public URL, checked as often as every 30 seconds |
| **Tracks speed, not just up/down** | Median, 95th and 99th percentile response times, charted over time |
| **Records outages** | Start, end, duration, and the HTTP error behind it |
| **Alerts your team** | Slack, Discord, or a plain JSON webhook, fired the moment status flips |
| **Shares a read-only link** | Send a graph to someone without giving them an account |
| **Keeps teams separate** | Invite teammates as admin or viewer; each team sees only its own data |

---

## Why I built it

<!-- Replace this section with your own story — why you picked this project,
     what you wanted to learn. The paragraph below is a placeholder. -->

Uptime monitoring looks trivial until you try to store the data. A single
endpoint checked every 30 seconds produces about a million rows a year. Ten
endpoints produce ten million, and "show me last year's response times" stops
being a query and starts being a design problem.

That was the interesting part. UptimeKit keeps three tiers of the same data —
every individual check for the recent past, hourly summaries behind that, daily
summaries behind that — and the chart silently picks whichever tier can answer
the question being asked. Old detail is rolled up and discarded on a schedule,
so storage stays flat instead of growing forever.

The second interesting part was making it multi-tenant without trusting the
application code to get it right. Every table is scoped by team inside the
database itself using Postgres row level security, so a bug in a query cannot
leak one team's monitors to another — the database refuses to return the rows.

---

## How it works

```
                  ┌──────────────┐
   you ──────────▶│ Web dashboard│──────┐
                  │  (Next.js)   │      │
                  └──────────────┘      ▼
                                   ┌──────────┐
                                   │ Supabase │  ← auth + Postgres + RLS
                                   │ Postgres │
                                   └──────────┘
   the internet ◀──┌──────────────┐      ▲
   (your URLs)     │    Worker    │──────┘
                   │ (BullMQ+Redis)│
                   └──────────────┘
```

Two runnable programs, one database, no API server between them.

| | Stack | Job |
| --- | --- | --- |
| **`src/web`** | Next.js 14, React, Tailwind, Recharts | The dashboard. Talks to Postgres directly from Server Components |
| **`src/worker`** | Node, BullMQ, Redis | Pings the URLs, writes results, rolls up old data, sends alerts |

The web app queries **as the signed-in user**, so row level security enforces
team isolation. The worker connects as `postgres` and bypasses it on purpose —
it is a trusted backend process with no user input in its query path.

---

## Run it locally

**You need:** [Node 22+](https://nodejs.org), a free
[Supabase](https://supabase.com) project, and [Docker](https://docker.com) (for
Redis — only if you want the worker).

### 1. Clone and install

```bash
git clone https://github.com/kcotiru/UptimeKit.git
cd UptimeKit

npm install              # worker
cd src/web && npm install && cd ../..
```

### 2. Create the database

Open your Supabase project → **SQL Editor** → **New query**. Paste the entire
contents of [`supabase/schema.sql`](supabase/schema.sql) and hit **Run**.

It is idempotent, so re-running it later is always safe.

### 3. Turn on email confirmation

Supabase project → **Authentication → Providers → Email** → switch
**Confirm email** to **on**.

Skip this and verification means nothing — `signUp()` hands back a working
session immediately, so any unverified address can sign straight in.

### 4. Fill in four values

Two files, two variables each. Nothing else is required, and no paths need
editing.

```bash
cp .env.example .env                                # worker
cp src/web/.env.local.example src/web/.env.local    # web
```

**`src/web/.env.local`** — from Supabase → **Project Settings → API**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The `anon` / publishable key |

**`.env`** — from Supabase → **Project Settings → Database**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The **Session pooler** connection string |
| `REDIS_URL` | `redis://localhost:6379` |

> ⚠️ Pick **Session pooler**, not *Direct connection*. `db.<ref>.supabase.co`
> is IPv6-only, so on an IPv4 network the worker hangs and then dies with
> `ENOTFOUND`.

No `service_role` key is needed anywhere. Signup used to require one to create
a team before the user had a session; a database trigger does that now, so the
RLS-bypassing key never touches a request path.

<details>
<summary>Optional worker settings and their defaults</summary>

| Variable | Default | Effect |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | `50` | Simultaneous in-flight pings |
| `DEGRADED_THRESHOLD_MS` | `5000` | Slower than this and a monitor reads `degraded`, not `up` |
| `SSRF_ALLOWLIST` | empty | Comma-separated hosts exempt from the private-IP block |
| `DATABASE_TEST_URL` | empty | A throwaway Postgres for the database-backed tests |

</details>

### 5. Start the dashboard

```bash
cd src/web
npm run dev
```

Open **http://localhost:3001**, register, click the confirmation email, log in.

That alone is a working app — you can add monitors right away. They sit at
`unknown` until something actually pings them, which is step 6.

### 6. Start the worker

The worker needs Redis. Supabase does not provide one, so:

```bash
docker run -d --name uptimekit-redis -p 6379:6379 redis:7-alpine
```

Then in a **second terminal**, from the repo root:

```bash
npm run worker
```

The container survives reboots — `docker start uptimekit-redis` brings it back.

Within about 30 seconds your monitors flip from `unknown` to `up` and the
charts start filling in.

### 7. Try the rest

- **Settings → Alerts** — add a Slack, Discord, or JSON webhook, then hit
  **Test** to confirm it works without waiting for a real outage.
- **Settings → Team members** — mint an invite link. Anyone holding it joins
  your team at the role you chose, so treat it like a password. Admins only.
- **Any monitor → Share** — a read-only public link to that graph.

---

## Tests

```bash
npm test                 # worker: 61 tests
cd src/web && npm test   # web: 135 tests
```

Both pass from a clean clone with no database configured. 35 of the worker
tests are database-backed and skip themselves unless you point
`DATABASE_TEST_URL` at a local Postgres:

```bash
createdb uptimekit_test
echo 'DATABASE_TEST_URL=postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_test' >> .env
npm test                 # now 96 tests
```

> ⚠️ Use a throwaway database. These tests apply the schema and write fixtures.
> `DATABASE_URL` is deliberately **not** used as a fallback, so a test missing
> its skip guard fails loudly instead of writing to your real project.

Want realistic data to look at without waiting hours for pings to accumulate?

```bash
SEED_CONFIRM=uptimekit_test npx ts-node scripts/seed-dev.ts
```

---

## Known issues & to-do

### Bugs

- **Three components disagree on what "success" means.** The worker flips a
  monitor to `down` when the status code is anything other than the expected
  one (default `200`); the hourly rollup counts `200–399` as a success; the
  dashboard counts anything `< 400`. A permanent redirect would therefore show
  a red `down` badge next to `uptime 100%`. Latent today because everything
  being monitored returns `200`. Fix: have the worker record its own verdict
  as a column, and read that everywhere.
- **Recent-metrics reporting on the live tier.** For monitors young enough to
  be served from raw pings, the list view reports the single most recent sample
  where it labels p50 and p99. Correct as a number, mislabelled as a statistic.

### Unfinished

- [ ] **Theme and Timezone** in the account menu are visible but disabled —
      wired up in a later pass.
- [ ] **No migration runner.** `supabase/schema.sql` is applied by hand. It is
      idempotent, but nothing enforces apply order (see below).
- [ ] **No landing page.** `/` redirects straight to the dashboard.
- [ ] **Email is Supabase's built-in sender** — a few messages an hour, and
      only to addresses attached to the Supabase project. Fine for a demo.
      Real delivery is custom SMTP under Authentication → Emails, which is
      dashboard configuration, not a code change.

---

## Deploying schema changes

> **Apply `supabase/schema.sql` first, then deploy code.**

Old code against a new schema is harmless — unknown columns and tables are
ignored. It is **new code against an old schema** that breaks, usually without
an error anyone sees.

<details>
<summary>What breaks, if you deploy in the wrong order</summary>

| Missing from the schema | Symptom |
| --- | --- |
| `monitors.timeout_ms` | `syncMonitors()` throws and **zero monitors get scheduled** — a silent monitoring outage |
| `saved_views`, `get_shared_view` | Creating or opening a shared graph link fails |
| `team_webhooks` | The Alerts settings page won't load or save |
| `percentile_source` | Every `hourly_to_daily` rollup throws; daily buckets go missing for the gap. Recover with `scripts/backfill-daily-rollups.ts` |
| `handle_new_user()`, `team_invites`, `describe_invite()` | `signUp()` creates an auth user with **no team**. It can sign in and then see nothing, forever. Invite links 404 too |

</details>

### Checking that partition maintenance is alive

The schema raises an exception if the `uptimekit-partitions` cron job fails to
register, so a clean apply proves it worked. To re-check later:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'uptimekit-partitions';
```

No rows means it is not scheduled — `ping_logs_raw` will start rejecting every
insert once the pre-created partitions run out, and monitoring stops silently.
Re-apply `supabase/schema.sql`.

---

## Repo layout

```
src/web/          Next.js dashboard
src/worker/       Ping scheduler, rollups, alerting
supabase/         schema.sql — tables, RLS policies, functions, cron
scripts/          Dev seeding and rollup backfill
tests/            Worker suite
docs/             Design system and specs
```
