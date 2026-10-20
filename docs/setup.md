# Setup: the deep end

[README](../README.md) covers the six steps that get the app running. This file
covers everything optional.

## Optional worker settings

All have working defaults, so `.env` needs none of them.

| Variable | Default | Effect |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | `50` | Simultaneous in-flight pings |
| `DEGRADED_THRESHOLD_MS` | `5000` | Slower than this and a monitor reads `degraded`, not `up` |
| `SSRF_ALLOWLIST` | empty | Comma-separated hosts exempt from the private-IP block |
| `DATABASE_TEST_URL` | empty | A throwaway Postgres for the database-backed tests |

Note that `DEGRADED_THRESHOLD_MS` defaults to the same 5000ms as a monitor's
`timeout_ms`, so at defaults a slow endpoint times out as `down` before it can
ever read `degraded`. Raise the monitor's timeout (max 30000) to see that state.

## Database-backed tests

48 of the worker's 160 tests skip themselves unless a test database is
configured:

```bash
createdb uptimekit_sdd_test
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d uptimekit_sdd_test -f tests/integration/helpers/bootstrap-local.sql
echo 'DATABASE_TEST_URL=postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_sdd_test' >> .env
npm test                 # 160 tests instead of 112
```

The `psql` line comes first on purpose. `supabase/schema.sql` assumes it runs on
Supabase, and a plain local Postgres lacks the pieces it needs: the `extensions`
schema with pgcrypto in it, the `anon` and `authenticated` roles, and an
`auth.users` table. [`bootstrap-local.sql`](../tests/integration/helpers/bootstrap-local.sql)
stubs them. Skip it and the schema fails to apply, and the tests with it.

Those commands use the POSIX `VAR=value cmd` form, which Git Bash runs as-is;
PowerShell needs `$env:PGPASSWORD='postgres'` on its own line first — see
[operations.md](operations.md#environment-variables-in-powershell).

The tests apply `schema.sql`, record it as the migration baseline, then apply
every pending migration, so they never run against a stale schema. (Don't feed
`schema.sql` to `psql` yourself: it schedules a `pg_cron` job, and a plain local
Postgres has no `pg_cron`. The tests strip that part; a hand-run does not.)
Once the tests have run, `npm run migrate` with no flags applies any migrations
added since, to the same database, because it targets `DATABASE_TEST_URL`.

That property — a green run means `schema.sql` plus every migration applied
cleanly — is also how you build the reference database the parity audit needs:
[operations.md → Baselining an existing
project](operations.md#baselining-an-existing-project).

> ⚠️ Use a throwaway database. These tests apply the schema and write fixtures.
> `DATABASE_URL` is deliberately **not** used as a fallback, so a test missing
> its skip guard fails loudly instead of writing to your real project.

## Seeding realistic data

Rather than waiting hours for pings to accumulate:

```bash
SEED_CONFIRM=uptimekit_sdd_test npx ts-node scripts/seed-dev.ts
```

## Trying the features

- **Settings → Alerts** — add a Slack, Discord, or JSON webhook, then hit
  **Test** to confirm it works without waiting for a real outage.
- **Settings → Team members** — mint an invite link. Anyone holding it joins
  your team at the role you chose, so treat it like a password. Admins only.
- **Settings → Shared views** — the read-only links handed out from a monitor's
  **Share** button, revocable here.
- **Any monitor → Share** — a read-only public link to that graph, no account
  needed to open it.

## Simulating monitor states

Useful endpoints for forcing a monitor into each state:

| State | URL |
| --- | --- |
| `up` | `https://httpbingo.org/status/200` |
| `down` (4xx) | `https://httpbingo.org/status/403` |
| `down` (5xx) | `https://httpbingo.org/status/500` |
| `down` (timeout) | `https://httpbingo.org/delay/10` with a monitor timeout under 10s |
| `degraded` | `https://httpbingo.org/delay/6` with the monitor's timeout raised above 6s |

`postman-echo.com` and `httpbin.dev` work as substitutes. Plain `httpbin.org`
and `httpstat.us` are unreachable from some networks.
