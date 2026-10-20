# Migrations

[`supabase/schema.sql`](../schema.sql) is the **baseline**: the schema as it
stood on 2026-10-20. It is frozen. Every change from here on is a file in this
folder, applied on top of it by the runner (`npm run migrate`).

The runner records what it has applied in `supabase_migrations.schema_migrations`,
the same table the Supabase CLI uses, so moving to that CLI later stays possible.
It stores version numbers only and never hashes file contents.

## Adding a migration

Two files, same name, one in each folder:

```
supabase/migrations/20261105143000_add_monitor_notes.sql
supabase/migrations/down/20261105143000_add_monitor_notes.sql
```

- The name is `<version>_<name>.sql`. The version is a **14-digit UTC
  timestamp**, `YYYYMMDDHHMMSS`. Generate it with `date -u +%Y%m%d%H%M%S`.
- The down file lives in `down/` with the **same filename**, and undoes the
  forward file.
- A forward migration with no down file is **rejected before anything is
  applied**, unless its very first line is `-- irreversible: <reason>`. The
  baseline is the one such file today.
- **The runner already owns the transaction.** It wraps your file and its history
  row in one `BEGIN`/`COMMIT`, so your file must not open its own. A file
  containing `BEGIN`, `COMMIT`, `ROLLBACK`, `START TRANSACTION` or `SAVEPOINT` is
  rejected up front: its `COMMIT` would end the runner's transaction early and
  leave the history row to commit on its own, so a failure there would keep the
  DDL. (`schema.sql:6` tells you to wrap *that* file in `BEGIN`/`COMMIT`; that
  advice is for the hand-pasted baseline only, not for migrations.)

Then, against the test database (`DATABASE_TEST_URL`):

```bash
npm run migrate                                           # apply pending
MIGRATE_CONFIRM=uptimekit_sdd_test npm run migrate:down   # revert the newest applied one
```

The confirm on that second line is not optional in practice. Any down file that
undoes a `CREATE TABLE` or an `ADD COLUMN` contains a `DROP TABLE` or an
`ALTER … DROP`, so the destructive guard fires and a bare `npm run migrate:down`
refuses. **For a local target the expected value is the database name**, which is
`uptimekit_sdd_test` if you followed [docs/setup.md](../../docs/setup.md#database-backed-tests).
(PowerShell: `$env:MIGRATE_CONFIRM='…'` on its own line — see
[docs/operations.md](../../docs/operations.md#environment-variables-in-powershell).)

Aim it elsewhere with `--db-url <url>`, or at your real project with `--hosted`.
`--hosted` needs `MIGRATE_CONFIRM=<supabase-project-ref>`. A migration or down
file containing a destructive statement (`DROP TABLE/COLUMN/SCHEMA/DATABASE/VIEW/
MATERIALIZED VIEW/TYPE`, `TRUNCATE`, `ALTER ... DROP`, an unqualified `DELETE`,
`DISABLE ROW LEVEL SECURITY`) needs `MIGRATE_CONFIRM` too — set to whatever the
**target** expects: the project ref when hosted, the database name when local.
Unknown flags are rejected, so a typo'd `--hostd` is an error, not a silent run
against the test database.

## Reverting is newest-first only

`npm run migrate:down` reverts the newest applied migration and nothing else.
That is a feature. A down file only ever has to be correct against the state its
own forward migration created, because nothing later can still be applied when
it runs. Reverting an arbitrary older migration was considered and rejected for
exactly that reason: its down file would have to be correct against every
combination of later changes.

## Four limits, stated plainly

**1. Reverting a destructive change restores structure, not rows.** A down file
that recreates a dropped column gives you an empty column back. The data went
with it. If a migration deletes data you might want, take a backup first; the
down file cannot help.

**2. Six tests describe the baseline, not the current schema.** These test
files assert on the text of `supabase/schema.sql`: `partitioning`, `monitors`,
`rollup`, `tier-query`, `rollup-concurrent` and `soft-delete-purge`. The first
migration that changes something they assert about will leave them passing while
describing a file that is no longer the schema. When a migration does that,
convert the affected test to query the applied database instead, as part of that
migration's work. Not before: converting them all now would be work against
changes that may never come.

**3. The unwind stops at the baseline.** `npm run migrate:down` walks back one
migration per run, so any point *after* the baseline stays reachable — and no
further. The baseline stub has no down file and carries `-- irreversible:`, so
the revert refuses there rather than trying to drop the whole schema. That floor
is deliberate, but it is a floor: "every change is revertible" means every change
made from 2026-10-20 onward, not the schema that existed on that date. Getting
behind the baseline means restoring a backup.

**4. A migration whose body sits inside the pg_cron fence is rehearsed nowhere.**
`npm run migrate` strips the `-- @local-test:strip-start (pg_cron)` …
`-- @local-test:strip-end` region for any non-hosted target, because local
Postgres has no `pg_cron`. So a migration whose real work lives inside that fence
runs locally as an **empty query**, is recorded as applied, and your local
rehearsal has proved nothing — the first real execution is against production.
This is not a corner case: the fence invariant in
`tests/integration/partitioning.test.ts` *requires* every `cron.` reference to be
fenced, and partition maintenance (the one thing living in there) is a plausible
thing to change. `tests/integration/helpers/db-setup.ts` records the same ceiling
for `schema.sql`. If you must change the fenced region, review it by hand, keep
it as small as you can, and check the result in production afterwards:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'uptimekit-partitions';
```
