# UptimeKit

UptimeKit is an HTTP monitor management and time-series performance analytics dashboard. Teams configure endpoint targets for background health checks, ping latency profiling, and uptime/downtime incident tracking.

## Architecture

Two runnable pieces, plus Supabase:

1. **Web Dashboard (`src/web`)** — Next.js 14 App Router (React, Tailwind, Recharts). Its Route Handlers and Server Components talk to **Supabase** directly: Supabase Auth for signup/login/sessions, Postgres with row level security for team isolation. There is no separate API server.
2. **Worker Engine (`src/worker`)** — BullMQ + Redis background service that schedules and executes health checks, then writes time-series results straight into Supabase's Postgres over the direct connection string.

Row level security scopes every table by `team_id`. The web app queries as the signed-in user, so isolation is enforced by the database. The worker connects as `postgres` and bypasses RLS by design — it is a trusted backend process.

---

## Prerequisites

- **Node.js** v20+
- A **Supabase** project (free tier is fine)
- **Redis** on port 6379 — only needed to run the worker (see below; Docker is enough)

---

## Setup

### 1. Create the schema

In the Supabase dashboard, open **SQL Editor**, paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. It is idempotent, so re-running is safe.

### 2. Configure the web app

```bash
cd src/web
cp .env.local.example .env.local
```

Fill in the three values from **Supabase → Project Settings → API**:

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key — server-only, never expose to the browser |

### 3. Configure the worker (optional)

```bash
cp .env.example .env
```

Set `DATABASE_URL` to the **Session pooler** URI from **Supabase → Project Settings → Database → Connection string**, and `REDIS_URL` to your local Redis. Use the pooler, not *Direct connection*: `db.<ref>.supabase.co` resolves to IPv6 only, so on an IPv4-only network the worker hangs and then fails with `ENOTFOUND`.

### 4. Install

```bash
npm install            # worker
cd src/web && npm install
```

---

## Deploying schema changes

`supabase/schema.sql` is applied by hand — there is no migration runner enforcing order. When a change to this repo touches both the schema and application code, apply `supabase/schema.sql` to Supabase **first**, then deploy the web app and worker. The reverse order (old worker/web code still running against a NEW schema) is fine — new columns and tables that old code doesn't know about are simply ignored. It is new code running against an OLD schema that breaks, in at least three ways:

- `monitor-scheduler.ts`'s `SELECT ... timeout_ms` throws because the column doesn't exist yet, `syncMonitors()` rejects, and **zero monitors get scheduled** — a silent monitoring outage, not a visible error.
- The saved-views share feature (`get_shared_view` RPC, the `saved_views` table) doesn't exist yet, so creating or viewing a shared graph link fails.
- The `team_webhooks` table doesn't exist yet, so the Notifications settings page fails to load or save webhooks.

Deploying old worker/web code against a new schema first, then rolling the schema forward, avoids all three.

### Verifying partition maintenance after applying the schema

`supabase/schema.sql` now raises an exception if the `uptimekit-partitions`
job fails to register, so a successful apply proves the job registered in a
database pg_cron polls. To confirm later — or to check that the job is still
scheduled and running — run this in the Supabase SQL Editor:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'uptimekit-partitions';
SELECT status, start_time, return_message
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'uptimekit-partitions')
 ORDER BY start_time DESC
 LIMIT 5;
```

If the first query returns no rows, partition maintenance is not scheduled:
`ping_logs_raw` will start rejecting every insert once the pre-created
partitions run out, and monitoring stops without a visible error. Re-apply
`supabase/schema.sql`.

---

## Running

### Web dashboard

```bash
cd src/web
npm run dev            # http://localhost:3001
```

That is the whole app. Register, log in, and create monitors without the worker running — they just sit at `paused` until something pings them.

### Worker engine

The worker needs Redis for its job queues. Supabase does not provide one. If you don't have Redis installed, Docker is the shortest path:

```bash
docker run -d --name uptimekit-redis -p 6379:6379 redis:7-alpine
```

That container persists across restarts — `docker start uptimekit-redis` brings it back later.

Then, in a second terminal from the repo root:

```bash
npm run worker
```

It syncs monitors every 30 seconds, pings each on its own interval, flips monitor status, and fills the time-series charts. A monitor shows `unknown` in the dashboard until the worker's first ping lands.

To pause a monitor without deleting it, set `is_paused = true` on its row — the scheduler skips those.

---

## Usage

1. Open **[http://localhost:3001](http://localhost:3001)**.
2. Register at `/register` — this creates a Supabase Auth user, a team, and the profile row linking them.
3. Click **Add Monitor** and enter a public endpoint (e.g. `https://google.com`). Minimum check interval is 30 seconds.
4. Start the worker to begin collecting pings, then open a monitor to see its time-series graph.
5. Open **Notifications** in the sidebar to add a Slack, Discord, or generic JSON webhook. Use **Test** to confirm the destination works without waiting for an outage. Without a webhook the worker still records incidents, but has nowhere to send them.

---

## Tests

```bash
npm test               # worker + schema assertions
cd src/web && npm test # validation and row-mapping
```
