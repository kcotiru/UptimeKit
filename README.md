# UptimeKit

HTTP uptime monitoring with time-series performance analytics. Teams register
endpoints; a background worker pings them on a schedule and records latency,
status changes, and outages into Postgres.

## Architecture

Two runnable pieces, plus Supabase:

1. **Web Dashboard (`src/web`)** — Next.js 14 App Router (React, Tailwind, Recharts). Its Route Handlers and Server Components talk to **Supabase** directly: Supabase Auth for signup/login/sessions, Postgres with row level security for team isolation. There is no separate API server.
2. **Worker Engine (`src/worker`)** — BullMQ + Redis background service that schedules and executes health checks, then writes time-series results straight into Supabase's Postgres over the direct connection string.

Row level security scopes every table by `team_id`. The web app queries as the signed-in user, so isolation is enforced by the database. The worker connects as `postgres` and bypasses RLS by design — it is a trusted backend process.

---

## Prerequisites

- **Node.js** v22+
- A **Supabase** project (free tier is fine)
- **Redis** on port 6379 — only needed to run the worker (see below; Docker is enough)

---

## Quick start

**You need:** Node 20+, a Supabase project (free tier is fine), and Redis on
6379 — the last one only if you want the worker.

```bash
# 1. schema — paste supabase/schema.sql into the Supabase SQL Editor and run it
# 2. config
cp .env.example .env                                  # worker
cp src/web/.env.local.example src/web/.env.local      # web
# 3. install
npm install && (cd src/web && npm install)
# 4. run
cd src/web && npm run dev                             # http://localhost:3001
```

`schema.sql` is idempotent — re-running it is safe.

The dashboard works on its own: register, confirm your address, log in, add
monitors. They sit at `unknown` until the worker pings them.

---

## Architecture

Two runnable pieces, plus Supabase. There is no separate API server.

| Piece | Stack | Talks to |
| --- | --- | --- |
| **Web dashboard** (`src/web`) | Next.js 14 App Router, React, Tailwind, Recharts | Supabase directly — Auth for sessions, Postgres via Server Components and Route Handlers |
| **Worker engine** (`src/worker`) | BullMQ + Redis | Postgres over the direct connection string |

**Isolation is the database's job.** Row level security scopes every table by
`team_id`, and the web app queries as the signed-in user. The worker connects
as `postgres` and bypasses RLS by design — it is a trusted backend process.

---

## Configuration

### Web app — `src/web/.env.local`

From **Supabase → Project Settings → API**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The `anon` / publishable key |

No `service_role` key is needed. Signup used to require one to create the team
before the user had a session; the `handle_new_user()` trigger does that inside
the database now, so the RLS-bypassing key never reaches a request path.

### Worker — `.env` (repo root)

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The **Session pooler** URI from Project Settings → Database |
| `REDIS_URL` | `redis://localhost:6379` |

> **Use the pooler, not *Direct connection*.** `db.<ref>.supabase.co` resolves
> to IPv6 only, so on an IPv4-only network the worker hangs and then fails with
> `ENOTFOUND`.

### Supabase dashboard settings

**Turn "Confirm email" ON** under Authentication → Providers → Email. Without
it verification means nothing: `signUp()` returns a usable session immediately
and unverified addresses can sign straight in.

Confirmation and password-reset mail goes through Supabase's built-in sender,
which is capped at a few messages an hour and only delivers to members of the
project. Fine for local use and demos; real delivery is custom SMTP under
Authentication → Emails, which is dashboard configuration, no code change.

---

## Running

### Web dashboard

```bash
cd src/web
npm run dev            # http://localhost:3001
```

### Worker engine

The worker needs Redis for its job queues; Supabase does not provide one.
Docker is the shortest path:

```bash
docker run -d --name uptimekit-redis -p 6379:6379 redis:7-alpine
npm run worker         # second terminal, repo root
```

The container persists — `docker start uptimekit-redis` brings it back later.

The worker syncs monitors every 30 seconds, pings each on its own interval,
flips monitor status, and fills the time-series charts. To pause a monitor
without deleting it, set `is_paused = true` on its row; the scheduler skips it.

### What to do in the app

1. **Register** at `/register`, then open the confirmation link before signing in.
   `signUp()` creates the Auth user and the `handle_new_user()` trigger creates
   the team and profile row in the same transaction — if it raises, the auth
   user rolls back too.
2. **Add a monitor** with any public endpoint (e.g. `https://google.com`).
   Minimum interval is 30 seconds.
3. **Start the worker**, then open a monitor for its time-series graph.
4. **Settings → Alerts** — add a Slack, Discord, or generic JSON webhook. Use
   **Test** to confirm the destination without waiting for an outage. Without
   one the worker still records incidents but has nowhere to send them.
5. **Settings → Team members** — mint an invite link. Anyone holding it
   registers straight into the team at the role you picked, so share it like a
   password. Admins only. Forgot a password? `/forgot-password` emails a reset.

---

## Deploying schema changes

`supabase/schema.sql` is applied by hand — no migration runner enforces order.

> **Apply the schema first, then deploy code.**

Old code against a new schema is fine: unknown columns and tables are simply
ignored. It is **new code against an old schema** that breaks, and mostly
silently:

<details>
<summary>The five failure modes, if you deploy in the wrong order</summary>

| Missing in the schema | What breaks |
| --- | --- |
| `monitors.timeout_ms` | `monitor-scheduler.ts`'s `SELECT` throws, `syncMonitors()` rejects, and **zero monitors get scheduled** — a silent monitoring outage, not a visible error |
| `get_shared_view` RPC, `saved_views` | Creating or viewing a shared graph link fails |
| `team_webhooks` | The Alerts settings page fails to load or save webhooks |
| `percentile_source` | Every `hourly_to_daily` rollup run throws, `rollup_logs` rows sit at `'failed'`, and daily buckets go missing for the gap — recoverable only via `scripts/backfill-daily-rollups.ts` |
| `handle_new_user()` trigger, `team_invites`, `describe_invite()` | `signUp()` creates an auth user with **no team and no profile row**. It can confirm and sign in, then hit an empty `current_team_id()` and see nothing, forever. Invite links 404 at the same time |

</details>

### Verifying partition maintenance

`schema.sql` raises an exception if the `uptimekit-partitions` job fails to
register, so a successful apply proves it registered in a database pg_cron
polls. To check later that it is still scheduled and running:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'uptimekit-partitions';

SELECT status, start_time, return_message
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'uptimekit-partitions')
 ORDER BY start_time DESC
 LIMIT 5;
```

No rows from the first query means partition maintenance is not scheduled:
`ping_logs_raw` will start rejecting every insert once the pre-created
partitions run out, and monitoring stops without a visible error. Re-apply
`supabase/schema.sql`.

---

## Tests

```bash
npm test                 # worker + schema assertions
cd src/web && npm test   # validation and row-mapping
```
