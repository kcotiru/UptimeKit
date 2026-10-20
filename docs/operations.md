# Operations

## Deploying schema changes

> **Apply the schema change first, then deploy code.**

`supabase/schema.sql` is the **baseline**: apply it once, in the Supabase SQL
Editor, and tell the runner you did (`npm run migrate -- --hosted
--baseline-only`, see the [README](../README.md)). Every schema change after
that is a file in [`supabase/migrations/`](../supabase/migrations/README.md),
and you apply it with:

```bash
MIGRATE_CONFIRM=<supabase-project-ref> npm run migrate -- --hosted
```

`--hosted` targets `DATABASE_URL`, i.e. your real project, so it refuses to run
without `MIGRATE_CONFIRM`. A migration containing a destructive statement
(dropping a table or column, `TRUNCATE`, an unqualified `DELETE`, and similar)
needs the same confirmation. The runner issues `NOTIFY pgrst, 'reload schema'`
itself after a hosted run, so do not add that as a manual step. Without it
Supabase's API keeps serving the old function signatures.

Not sure a database matches `schema.sql`? Compare two with
`npm run audit:parity -- --a <url> --b <url>`. It only reads. Give it a direct or
session-pooler URL (port **5432**), not the transaction pooler (6543): its
read-only guard is set per connection, and the transaction pooler can hand each
statement to a different one.

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
