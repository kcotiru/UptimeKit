# UptimeKit Spec Plan

## Core Tech
Frontend: Next.js (SSR).
Backend API: Node.js + Express.
Worker: Node.js.
DB: PostgreSQL + TimescaleDB extension.
Queue: Redis + BullMQ.

## DB Schema (TimescaleDB)

Tables:
- `users`: `id`, `email`, `password_hash`.
- `teams`: `id`, `name`.
- `team_members`: `team_id`, `user_id`, `role`.
- `monitors`: `id`, `team_id`, `name`, `url`, `type`, `interval_sec`. (Types: HTTP, TCP, Keyword match)
- `ping_logs`: `time` (TIMESTAMPTZ), `monitor_id`, `response_ms`, `status_code`, `is_up`.
- `incidents`: `id`, `monitor_id`, `started_at`, `resolved_at`, `cause`, `status` ('ONGOING', 'RESOLVED').
- `alert_channels`: `id`, `team_id`, `type` ('DISCORD', 'SLACK', 'EMAIL', 'WEBHOOK'), `config` (JSONB), `is_enabled`.

Timescale setup:
- Turn `ping_logs` into hypertable partition by `time`.
- Create Continuous Aggregate for 1-hour buckets (avg, min, max, p95).
- Add Retention Policy. Drop raw `ping_logs` > 7 days old. Keep hourly aggregate forever.

Auth Schema Note:
Write custom JWT in Express. DB schema match Supabase Auth + RLS structure. Easy migrate later.

## API Service

Tasks:
- CRUD users, teams, monitors.
- Issue JWT tokens.
- Fetch ping logs for UI graph.

Auth:
- Middleware check JWT.
- Ensure user in team before read/write `monitors` or `ping_logs`.

## Polling Worker Service

Flow:
1. Cron job push all active `monitors` to BullMQ every minute.
2. BullMQ Workers pick up jobs.
3. Worker ping URL, measure response time.
4. Worker insert result to `ping_logs` table.

Scale: Add more worker nodes. Redis distribute load.
Dev: Single local container. Prod: Multi-region cloud instances.

## Alerting

Flow:
1. Event-driven Alert Queue trigger when monitor down.
2. Webhooks hit Discord/Slack.
3. Resend/Nodemailer send email.

## Frontend UI

Dashboard:
- List team monitors.
- Show current status (Up/Down).
- Render chart for response time.

Share State:
- Save chart zoom in URL. Example: `?monitor=123&start=1690000000&end=1690014400`.
- Send link to teammate. Teammate open link, UI read URL params, fetch exact time range. No DB state for UI zoom.

## Performance & Efficiency

- **Database Connection Pooling**: PgBouncer in front of PostgreSQL/TimescaleDB.
- **Worker Monitor Cache**: Active monitor configs cached in Redis; avoids querying Postgres on every 1-minute cron dispatch.
- **Write Batching**: Workers buffer ping logs in memory/Redis and batch-insert (buffer 100 logs or flush every 5s) into TimescaleDB hypertable.
- **Query Caching**: Aggregate time-series API responses cached in Redis + SWR/React Query on Next.js frontend.

## Security Practices

- **SSRF Protection**: Worker validates host IPs before network requests; blocks loopback (`127.0.0.0/8`), private CIDRs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and cloud metadata (`169.254.169.254`).
- **Password Security**: Argon2id or bcrypt (cost factor 12) for user password hashing.
- **JWT Storage**: Tokens stored strictly in `HttpOnly`, `SameSite=Strict`, `Secure` cookies (no localStorage token storage).
- **Rate Limiting**: `express-rate-limit` with Redis token bucket on login, registration, and API routes.
- **Encryption at Rest**: AES-256-GCM / pgcrypto encryption for webhook secrets and sensitive credentials in `alert_channels`.

