/**
 * Partition management procedures and functions for UptimeKit.
 */

-- Create daily partition for ping_logs_raw table for target_date (UTC)
CREATE OR REPLACE FUNCTION create_daily_partition(target_date DATE)
RETURNS TEXT AS $$
DECLARE
  partition_name TEXT;
  start_ts TIMESTAMPTZ;
  end_ts TIMESTAMPTZ;
  sql_stmt TEXT;
BEGIN
  partition_name := 'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD');
  start_ts := target_date::TIMESTAMPTZ;
  end_ts := (target_date + INTERVAL '1 day')::TIMESTAMPTZ;

  sql_stmt := format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF ping_logs_raw FOR VALUES FROM (%L) TO (%L);',
    partition_name, start_ts, end_ts
  );

  EXECUTE sql_stmt;
  RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Detach and drop partitions older than retention_days (default 7 days)
CREATE OR REPLACE FUNCTION drop_expired_partitions(retention_days INTEGER DEFAULT 7)
RETURNS TABLE (dropped_partition TEXT) AS $$
DECLARE
  r RECORD;
  partition_date DATE;
  cutoff_date DATE;
BEGIN
  cutoff_date := CURRENT_DATE - retention_days;

  FOR r IN 
    SELECT c.relname AS child_name
    FROM pg_inherits i
    JOIN pg_class c ON i.inhrelid = c.oid
    JOIN pg_class p ON i.inhparent = p.oid
    WHERE p.relname = 'ping_logs_raw'
  LOOP
    BEGIN
      partition_date := to_date(substring(r.child_name from 'ping_logs_raw_([0-9]{8})$'), 'YYYYMMDD');
      IF partition_date < cutoff_date THEN
        EXECUTE format('ALTER TABLE ping_logs_raw DETACH PARTITION %I;', r.child_name);
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE;', r.child_name);
        dropped_partition := r.child_name;
        RETURN NEXT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Skip non-matching child tables
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- List active partitions of ping_logs_raw
CREATE OR REPLACE FUNCTION list_active_partitions()
RETURNS TABLE (partition_name TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT c.relname::TEXT
  FROM pg_inherits i
  JOIN pg_class c ON i.inhrelid = c.oid
  JOIN pg_class p ON i.inhparent = p.oid
  WHERE p.relname = 'ping_logs_raw'
  ORDER BY c.relname;
END;
$$ LANGUAGE plpgsql;
