# Operations

## Environment variables in PowerShell

Every command in these docs is written in the POSIX form `VAR=value cmd`, which
Git Bash (shipped with Git for Windows) runs as-is. **PowerShell does not**: it
reports `The term 'VAR=value' is not recognized`. Set the variable first and run
the command without the prefix:

```powershell
$env:MIGRATE_CONFIRM = '<supabase-project-ref>'
npm run migrate -- --hosted
Remove-Item Env:MIGRATE_CONFIRM        # it otherwise lives as long as the shell
```

Everything below assumes the POSIX form. This is the only place it is explained.

## Baselining an existing project

`npm run migrate -- --hosted --baseline-only` records `supabase/schema.sql` as
applied **without executing it**. That is an assertion: *this database already
equals `schema.sql`*. Nothing has ever verified it, and the drift this runner
exists to prevent — an edit inside a `CREATE TABLE IF NOT EXISTS` body never
reaching a table that already exists — is exactly what would have made it false.

**Verify before you record, because the order is one-way.** Once the baseline row
is written, forward drift gets fixed by the next migration and **backward drift
is undetectable forever**: every later migration stacks on a foundation nothing
can re-check, and the history table says it was verified.

The audit compares **two live databases**, never a database against a file, so
step 1 exists to build the database it needs.

**1. Build a reference database from `schema.sql`.**

```bash
PGPASSWORD=postgres createdb -h 127.0.0.1 -U postgres uptimekit_parity_ref
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d uptimekit_parity_ref \
  -f tests/integration/helpers/bootstrap-local.sql
DATABASE_TEST_URL=postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_parity_ref npm test
```

`npm test` is the apply step, not a detour: its harness strips the `pg_cron`
fence from `schema.sql` (a plain local Postgres has no `pg_cron`, so a hand-run
`psql -f supabase/schema.sql` dies part-way — see [setup.md](setup.md#database-backed-tests)),
applies it, records the baseline and applies every migration. A green run is also
your proof the schema applied cleanly. The fixture rows it writes do not matter:
the audit reads catalogs only, never data.

**2. Compare production against the reference.**

```bash
MIGRATE_CONFIRM=<supabase-project-ref> npm run audit:parity -- \
  --a '<production-session-pooler-url>' \
  --b postgresql://postgres:postgres@127.0.0.1:5432/uptimekit_parity_ref
```

It only reads: every connection is set read-only before the first query and
every query is a `SELECT` on a system catalog. It refuses a hosted target
without `MIGRATE_CONFIRM=<project-ref>`, and it refuses `--a` and `--b` being
the same URL (comparing a database with itself always "passes"). Use the direct
or session-pooler URL, port **5432**, not the transaction pooler (6543): the
read-only guard is per connection and the transaction pooler can hand each
statement to a different one. It exits 1 if anything differs. The header comment
of [`scripts/audit-schema-parity.ts`](../scripts/audit-schema-parity.ts) lists
what it does **not** compare — `cron.job` is the biggest gap; check that one by
hand (see below).

**3. Reconcile any drift as the first migration, reviewed by hand.**

Write it into [`supabase/migrations/`](../supabase/migrations/README.md) with its
down file, rehearse it against the reference database
(`npm run migrate -- --db-url postgresql://…/uptimekit_parity_ref`), and read it
yourself before it runs anywhere else. Do not let the runner paper over drift:
the diff tells you production is not what the file says, and that is a fact worth
a reviewed migration.

**4. Only then record the baseline.**

```bash
MIGRATE_CONFIRM=<supabase-project-ref> npm run migrate -- --hosted --baseline-only
```

**5. Drop the reference database** — `PGPASSWORD=postgres dropdb -h 127.0.0.1 -U
postgres uptimekit_parity_ref`. Rebuild it the same way whenever you want to
re-audit.

## Deploying schema changes

> **Apply the schema change first, then deploy code.**

`supabase/schema.sql` is the **baseline**: apply it once, in the Supabase SQL
Editor, then verify and record it — see [Baselining an existing
project](#baselining-an-existing-project) above, which must happen before the
first migration. Every schema change after that is a file in
[`supabase/migrations/`](../supabase/migrations/README.md), and you apply it
with:

```bash
MIGRATE_CONFIRM=<supabase-project-ref> npm run migrate -- --hosted
```

`--hosted` targets `DATABASE_URL`, i.e. your real project, so it refuses to run
without `MIGRATE_CONFIRM`. A migration containing a destructive statement
(dropping a table or column, `TRUNCATE`, an unqualified `DELETE`, and similar)
needs the same confirmation. The runner issues `NOTIFY pgrst, 'reload schema'`
itself after a hosted run, so do not add that as a manual step. Without it
Supabase's API keeps serving the old function signatures.

Not sure a database matches `schema.sql`? That is the parity audit, and it needs a
reference database to compare against — the full procedure is [Baselining an
existing project](#baselining-an-existing-project) above.

Old code against a new schema is harmless — unknown columns and tables are
ignored. It is **new code against an old schema** that breaks, usually without
an error anyone sees:

| Missing from the schema | Symptom |
| --- | --- |
| `monitors.timeout_ms` | `syncMonitors()` throws and **zero monitors get scheduled** — a silent monitoring outage |
| `saved_views`, `get_shared_view` | Creating or opening a shared graph link fails |
| `team_webhooks` | The Alerts settings page won't load or save |
| `percentile_source` | Every `hourly_to_daily` rollup throws; daily buckets go missing for the gap. Recover with `scripts/backfill-daily-rollups.ts` |
| `handle_new_user()`, `team_invites`, `describe_invite()` | `signUp()` creates an auth user with **no team**. It can sign in and then see nothing, forever. Invite links 404 too |

## Checking that partition maintenance is alive

The schema raises an exception if the `uptimekit-partitions` cron job fails to
register, so a clean apply proves it worked. To re-check later:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'uptimekit-partitions';
```

No rows means it is not scheduled — `ping_logs_raw` will start rejecting every
insert once the pre-created partitions run out, and monitoring stops silently.
Re-apply `supabase/schema.sql`.
