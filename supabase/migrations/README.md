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

Then, against the test database (`DATABASE_TEST_URL`):

```bash
npm run migrate          # apply pending
npm run migrate:down     # revert the newest applied one
```

Aim it elsewhere with `--db-url <url>`, or at your real project with `--hosted`.
`--hosted` needs `MIGRATE_CONFIRM=<supabase-project-ref>`. So does any migration
containing a destructive statement (`DROP TABLE/COLUMN/SCHEMA/DATABASE/VIEW/
MATERIALIZED VIEW/TYPE`, `TRUNCATE`, `ALTER ... DROP`, an unqualified `DELETE`,
`DISABLE ROW LEVEL SECURITY`).

## Reverting is newest-first only

`npm run migrate:down` reverts the newest applied migration and nothing else.
That is a feature. A down file only ever has to be correct against the state its
own forward migration created, because nothing later can still be applied when
it runs. Reverting an arbitrary older migration was considered and rejected for
exactly that reason: its down file would have to be correct against every
combination of later changes.

## Two limits, stated plainly

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
