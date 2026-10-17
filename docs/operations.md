# Operations

## Deploying schema changes

> **Apply `supabase/schema.sql` first, then deploy code.**

It is idempotent, so re-running it is always safe.

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
