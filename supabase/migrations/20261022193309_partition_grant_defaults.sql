-- Keep the grant floor from expiring overnight.
--
-- 20261022183938_role_aware_rls.sql revoked the write privileges that Supabase
-- provisioning hands `anon` and `authenticated`, but it could only revoke them
-- from the tables that existed when it ran. `create_daily_partition()` runs as
-- `postgres` from the scheduled maintenance job at 03:00 (schema.sql:901-908,
-- inside the strip fence, so the extension name is deliberately not written
-- here: the fence invariant in tests/integration/partitioning.test.ts forbids
-- it anywhere in a migration) and creates
-- tomorrow's ping_logs_raw partition, which is a brand new table in `public`
-- and therefore picks up the schema's default privileges: every write privilege
-- back, on a table PostgREST exposes by name. The revoke silently stopped
-- protecting anything roughly eight hours after it was applied.
--
-- Two defences, because they fail differently:
--   1. The default privileges, which cover every future table in `public`, not
--      only partitions.
--   2. An explicit REVOKE inside create_daily_partition(), on the partition it
--      just made. This one is load bearing: it does not depend on the default
--      privilege bookkeeping being keyed to the role that turns out to create
--      the table, and it brings a partition into line even when it already
--      existed (the CREATE is IF NOT EXISTS, the REVOKE is unconditional).
--
-- MAINTAIN is in every list below. pg_default_acl on the live project grants
-- anon and authenticated `arwdDxtm`, and PostgreSQL 17's trailing `m` is
-- MAINTAIN: VACUUM, ANALYZE, REINDEX, CLUSTER and LOCK TABLE. It was not in the
-- earlier revoke's list, so `authenticated` still holds it on every table in
-- production. The local harness could not see it either, because
-- tests/integration/helpers/bootstrap-local.sql granted only the seven named
-- privileges; that file now grants MAINTAIN too, so this revoke is exercised
-- rather than being a no-op against a privilege nobody had granted.
--
-- SELECT stays, in every list, for the same reason as the earlier migration:
-- the web app reads the ping tiers directly as the signed-in user and RLS
-- performs the tenancy check, so revoking SELECT would blank every chart.

-- ---------------------------------------------------------------------------
-- Defence 1: every table created in `public` from here on
-- ---------------------------------------------------------------------------

-- Default privileges are keyed to the role that CREATES the object, defaulting
-- to the role running this statement. That is `postgres`, which is the role the
-- migration runner connects as, the role that owns schema.sql's tables, and the
-- role the scheduled job runs its create_daily_partition() calls as. The live
-- project has a second entry granted by `supabase_admin`; it is deliberately
-- left alone, because it only governs tables that role creates and rewriting a
-- Supabase-owned default ACL is not ours to do.
--
-- FOR ROLE is written out rather than left to the default. The default is
-- whoever runs this file, so an apply from the Supabase dashboard SQL editor
-- under a different superuser would key the entry to that role instead and
-- protect nothing the scheduled job creates. No test in this suite could catch
-- that, because the harness applies migrations as the same role it creates
-- tables as. Naming it also makes the entry legible in pg_default_acl.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- The tables that already exist
-- ---------------------------------------------------------------------------

-- MAINTAIN only, swept across the whole schema. Deliberately NOT the write
-- privileges as well: the earlier migration hands `authenticated` back exactly
-- the writes the app performs (INSERT/UPDATE/DELETE on monitors and
-- team_webhooks, and column lists on saved_views and team_invites), and an
-- ON ALL TABLES sweep of those here would silently take them away again.
-- Nothing is ever granted MAINTAIN back, so the sweep is safe in that direction.
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- The WRITE privileges on the partitions of ping_logs_raw that already exist.
-- MAINTAIN is not in this pass's remit: a partition is an ordinary table in
-- `public`, so the ON ALL TABLES sweep above already reached it. What that sweep
-- could not do is take the writes, and a REVOKE on a partitioned parent does not
-- reach its partitions, so the earlier migration's revoke on ping_logs_raw left
-- every existing partition writable when addressed by name, with RLS and no
-- policy of its own as the only thing denying that path. The REVOKE below still
-- names MAINTAIN, harmlessly and for one list rather than two, so that this file
-- reads the same wherever it revokes.
--
-- One statement per partition, aggregated into a single EXECUTE rather than a
-- FOR loop, because a loop variable has to be DECLAREd and the migration runner
-- rejects any file where a `;` precedes BEGIN: that is how a file opening its
-- own transaction reads to it (src/db/migrate.ts:71-73). The coalesce is for a
-- database with no partitions yet, where EXECUTE would otherwise get NULL.
DO $do$
BEGIN
  EXECUTE coalesce(
    (
      SELECT string_agg(
        format(
          'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON %s FROM anon, authenticated;',
          c.oid::regclass
        ),
        ' '
      )
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'public.ping_logs_raw'::regclass
    ),
    'SELECT 1'
  );
END
$do$;

-- ---------------------------------------------------------------------------
-- Defence 2: the partition create_daily_partition() just made
-- ---------------------------------------------------------------------------

-- Verbatim from schema.sql:293-316 apart from two things: the REVOKE after the
-- ENABLE ROW LEVEL SECURITY, and the DECLARE block folded away for the runner
-- reason noted above, which is why the partition name is recomputed rather than
-- held in a variable.
CREATE OR REPLACE FUNCTION create_daily_partition(target_date DATE)
RETURNS TEXT AS $$
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF ping_logs_raw FOR VALUES FROM (%L) TO (%L);',
    'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD'),
    target_date::TIMESTAMPTZ,
    (target_date + INTERVAL '1 day')::TIMESTAMPTZ
  );
  -- A partition is a plain table in `public`, so PostgREST exposes it by name and
  -- the parent's policy does NOT apply to a direct hit. RLS with no policy of its
  -- own denies that path while reads through ping_logs_raw keep working.
  EXECUTE format(
    'ALTER TABLE %I ENABLE ROW LEVEL SECURITY;',
    'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD')
  );
  -- And the grant floor underneath that policy check, so a write to the
  -- partition by name is refused before any policy is consulted. Unconditional,
  -- so re-running this for an existing partition fixes that partition too.
  EXECUTE format(
    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON %I FROM anon, authenticated;',
    'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD')
  );
  RETURN 'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD');
END;
-- search_path pinned for the same reason as the definer functions in schema.sql,
-- even though this one is INVOKER: it builds DDL with format() against
-- unqualified names, and pg_temp is searched first for relations unless it is
-- named explicitly.
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;
