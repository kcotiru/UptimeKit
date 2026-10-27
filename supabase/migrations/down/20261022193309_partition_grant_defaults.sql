-- Undoes 20261022193309_partition_grant_defaults.sql: puts the write and
-- MAINTAIN privileges back where that migration removed them, and restores
-- create_daily_partition() to the schema.sql body with no REVOKE in it.
--
-- This hands `anon` and `authenticated` write privileges on every future table
-- in `public` again, which is the state the forward migration exists to end.
-- It is here because the runner requires a down twin, not because reverting is
-- a good idea on a live project.

-- FOR ROLE postgres, mirroring the forward file: the entry being reversed is
-- the one keyed to that role, and omitting it here would key this GRANT to
-- whoever runs the revert and leave the forward entry in place.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;

GRANT MAINTAIN ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- The existing partitions of ping_logs_raw. Same aggregated-EXECUTE shape as
-- the forward file, for the same reason: no DECLARE, so no `;` before BEGIN.
DO $do$
BEGIN
  EXECUTE coalesce(
    (
      SELECT string_agg(
        format(
          'GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON %s TO anon, authenticated;',
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

-- schema.sql:293-316, with the DECLARE block folded away for the runner reason
-- noted in the forward file. Behaviour is the schema.sql behaviour: create the
-- partition, enable RLS on it, and leave its grants alone.
CREATE OR REPLACE FUNCTION create_daily_partition(target_date DATE)
RETURNS TEXT AS $$
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF ping_logs_raw FOR VALUES FROM (%L) TO (%L);',
    'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD'),
    target_date::TIMESTAMPTZ,
    (target_date + INTERVAL '1 day')::TIMESTAMPTZ
  );
  EXECUTE format(
    'ALTER TABLE %I ENABLE ROW LEVEL SECURITY;',
    'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD')
  );
  RETURN 'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD');
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;
