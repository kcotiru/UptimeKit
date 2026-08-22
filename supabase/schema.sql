-- UptimeKit — full schema for Supabase.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Auth (signup/login/sessions/password hashing) is handled by Supabase Auth;
-- `public.users` only maps an auth user to a team + role.

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'free',
  quota_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member', 'viewer')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);

-- Tenant key for every RLS policy below. SECURITY DEFINER so the policy on
-- `users` cannot recurse into itself.
CREATE OR REPLACE FUNCTION current_team_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_id FROM users WHERE id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Monitors
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Defaulted so inserts from the web app never have to pass (or spoof) a team.
  team_id UUID NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
  name VARCHAR(255) NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  http_method VARCHAR(10) NOT NULL DEFAULT 'GET',
  expected_status INTEGER NOT NULL DEFAULT 200,
  -- Mirrored by the web form's validation (src/web/lib/validations/monitor.ts).
  check_interval INTEGER NOT NULL CHECK (check_interval >= 30),
  -- Health, written by the worker. Starts 'paused' meaning "not yet checked".
  status VARCHAR(50) NOT NULL DEFAULT 'paused' CHECK (status IN ('up', 'down', 'degraded', 'paused')),
  -- User intent, separate from health: the scheduler skips is_paused monitors.
  is_paused BOOLEAN NOT NULL DEFAULT false,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Added after the initial release, so ADD COLUMN rather than a table field.
-- Bounds mirror createMonitorSchema in src/web/lib/shared/validations/monitor.ts.
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 5000;

DO $$
BEGIN
  ALTER TABLE monitors ADD CONSTRAINT monitors_timeout_ms_range
    CHECK (timeout_ms BETWEEN 1000 AND 30000);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_monitor_team_active ON monitors(team_id, is_deleted);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  monitor_id UUID NOT NULL REFERENCES monitors(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  cause TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor_active ON incidents(monitor_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_incidents_team_active ON incidents(team_id, is_deleted);

CREATE TABLE IF NOT EXISTS team_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('slack', 'discord', 'generic')),
  url TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_webhooks_team_active ON team_webhooks(team_id, is_deleted);

-- ---------------------------------------------------------------------------
-- Time-series tiers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ping_logs_raw (
  monitor_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  team_id UUID NOT NULL,
  response_time_ms INTEGER NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  PRIMARY KEY (monitor_id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_ping_raw_team_time ON ping_logs_raw (team_id, timestamp);

-- Column names and the (team_id, monitor_id, bucket_start) key are what
-- src/worker/processors/rollup-processor.ts writes and ON CONFLICTs against.
CREATE TABLE IF NOT EXISTS ping_logs_hourly (
  team_id UUID NOT NULL,
  monitor_id UUID NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  total_pings INTEGER NOT NULL,
  successful_pings INTEGER NOT NULL,
  avg_response_time_ms INTEGER NOT NULL,
  min_response_time_ms INTEGER NOT NULL,
  max_response_time_ms INTEGER NOT NULL,
  p50_response_time_ms INTEGER NOT NULL,
  p95_response_time_ms INTEGER NOT NULL,
  p99_response_time_ms INTEGER NOT NULL,
  PRIMARY KEY (team_id, monitor_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_ping_hourly_team_time ON ping_logs_hourly (team_id, bucket_start);

CREATE TABLE IF NOT EXISTS ping_logs_daily (
  team_id UUID NOT NULL,
  monitor_id UUID NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  total_pings INTEGER NOT NULL,
  successful_pings INTEGER NOT NULL,
  avg_response_time_ms INTEGER NOT NULL,
  min_response_time_ms INTEGER NOT NULL,
  max_response_time_ms INTEGER NOT NULL,
  p50_response_time_ms INTEGER NOT NULL,
  p95_response_time_ms INTEGER NOT NULL,
  p99_response_time_ms INTEGER NOT NULL,
  PRIMARY KEY (team_id, monitor_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_ping_daily_team_time ON ping_logs_daily (team_id, bucket_start);

CREATE TABLE IF NOT EXISTS rollup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rollup_type VARCHAR(50) NOT NULL CHECK (rollup_type IN ('raw_to_hourly', 'hourly_to_daily')),
  time_window TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  input_records INTEGER NOT NULL DEFAULT 0,
  output_records INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  executed_at TIMESTAMPTZ,
  CONSTRAINT unique_rollup_type_window UNIQUE (rollup_type, time_window)
);

CREATE INDEX IF NOT EXISTS idx_rollup_log_type_status ON rollup_logs(rollup_type, status);

CREATE TABLE IF NOT EXISTS deletion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES monitors(id),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  batches_processed INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_queue_status ON deletion_queue(status);

-- Soft-deleting a monitor queues its ping logs for purging. A trigger, not app
-- code, so every delete path (web, worker, manual SQL) enqueues exactly once.
-- SECURITY DEFINER because deletion_queue has RLS on with no policy.
CREATE OR REPLACE FUNCTION enqueue_monitor_purge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO deletion_queue (monitor_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS monitors_enqueue_purge ON monitors;
CREATE TRIGGER monitors_enqueue_purge
  AFTER UPDATE OF is_deleted ON monitors
  FOR EACH ROW
  WHEN (NEW.is_deleted AND NOT OLD.is_deleted)
  EXECUTE FUNCTION enqueue_monitor_purge();

CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  creator_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  configuration JSONB NOT NULL,
  share_token VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_team_id ON saved_views(team_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_share_token ON saved_views(share_token);

-- ---------------------------------------------------------------------------
-- Partition management for ping_logs_raw
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_daily_partition(target_date DATE)
RETURNS TEXT AS $$
DECLARE
  partition_name TEXT;
BEGIN
  partition_name := 'ping_logs_raw_' || to_char(target_date, 'YYYYMMDD');
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF ping_logs_raw FOR VALUES FROM (%L) TO (%L);',
    partition_name, target_date::TIMESTAMPTZ, (target_date + INTERVAL '1 day')::TIMESTAMPTZ
  );
  -- A partition is a plain table in `public`, so PostgREST exposes it by name and
  -- the parent's policy does NOT apply to a direct hit. RLS with no policy of its
  -- own denies that path while reads through ping_logs_raw keep working.
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', partition_name);
  RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION drop_expired_partitions(retention_days INTEGER DEFAULT 7)
RETURNS TABLE (dropped_partition TEXT) AS $$
DECLARE
  r RECORD;
  partition_date DATE;
  cutoff_date DATE := CURRENT_DATE - retention_days;
BEGIN
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

-- Backfill: partitions created before create_daily_partition() enabled RLS.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS child_name
    FROM pg_inherits i
    JOIN pg_class c ON i.inhrelid = c.oid
    JOIN pg_class p ON i.inhparent = p.oid
    WHERE p.relname = 'ping_logs_raw' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.child_name);
  END LOOP;
END $$;

-- Pre-create a month of partitions so the worker can insert immediately.
DO $$
DECLARE d DATE;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - 7, CURRENT_DATE + 30, '1 day')::DATE LOOP
    PERFORM create_daily_partition(d);
  END LOOP;
END $$;

-- Keep a rolling 14-day runway of partitions and drop what retention has passed.
-- Idempotent: create_daily_partition is CREATE TABLE IF NOT EXISTS, and the
-- unschedule/schedule pair means re-running this file does not stack duplicate jobs.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('uptimekit-partitions');
EXCEPTION WHEN OTHERS THEN
  -- No such job yet on a first run.
  NULL;
END $$;

SELECT cron.schedule(
  'uptimekit-partitions',
  '0 3 * * *',
  $job$
    SELECT create_daily_partition((CURRENT_DATE + i)::date) FROM generate_series(0, 14) i;
    SELECT drop_expired_partitions(7);
  $job$
);

-- ---------------------------------------------------------------------------
-- Tier-aware metric read (raw < 7d, hourly < 90d, daily beyond)
-- ---------------------------------------------------------------------------

-- The three-tier read, with the tenant as a parameter. SECURITY INVOKER, so an
-- authenticated caller passing another team's UUID still hits RLS on the
-- ping_logs_* tables and gets nothing. Called from get_shared_view (which is
-- SECURITY DEFINER), the invoker is the definer's role and RLS is bypassed —
-- that is the whole point of the split.
CREATE OR REPLACE FUNCTION select_ping_tier_for_team(
  target_team_id UUID,
  target_monitor_id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
RETURNS TABLE (
  -- Named `ts`, not `timestamp`: an output column named `timestamp` is parsed
  -- as a type name and fails, even though the base tables may use that name.
  ts TIMESTAMPTZ,
  response_time_ms NUMERIC,
  min_time_ms INTEGER,
  max_time_ms INTEGER,
  p95_time_ms INTEGER,
  sample_count INTEGER,
  status_code INTEGER,
  source_tier TEXT
) AS $$
DECLARE
  now_ts TIMESTAMPTZ := NOW();
  raw_cutoff TIMESTAMPTZ := now_ts - INTERVAL '7 days';
  hourly_cutoff TIMESTAMPTZ := now_ts - INTERVAL '90 days';
BEGIN
  RETURN QUERY
  SELECT
    r.timestamp,
    r.response_time_ms::NUMERIC,
    r.response_time_ms,
    r.response_time_ms,
    r.response_time_ms,
    1,
    r.status_code,
    'raw'::TEXT
  FROM ping_logs_raw r
  WHERE r.monitor_id = target_monitor_id
    AND r.team_id = target_team_id
    AND r.timestamp BETWEEN start_time AND end_time
    AND r.timestamp >= raw_cutoff

  UNION ALL

  SELECT
    h.bucket_start,
    h.avg_response_time_ms::NUMERIC,
    h.min_response_time_ms,
    h.max_response_time_ms,
    h.p95_response_time_ms,
    h.total_pings,
    NULL::INTEGER,
    'hourly'::TEXT
  FROM ping_logs_hourly h
  WHERE h.monitor_id = target_monitor_id
    AND h.team_id = target_team_id
    AND h.bucket_start BETWEEN start_time AND end_time
    AND h.bucket_start < raw_cutoff
    AND h.bucket_start >= hourly_cutoff

  UNION ALL

  SELECT
    d.bucket_start,
    d.avg_response_time_ms::NUMERIC,
    d.min_response_time_ms,
    d.max_response_time_ms,
    d.p95_response_time_ms,
    d.total_pings,
    NULL::INTEGER,
    'daily'::TEXT
  FROM ping_logs_daily d
  WHERE d.monitor_id = target_monitor_id
    AND d.team_id = target_team_id
    AND d.bucket_start BETWEEN start_time AND end_time
    AND d.bucket_start < hourly_cutoff

  ORDER BY 1 ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- Unchanged signature — src/web/lib/server/data/monitors.ts calls this via RPC.
CREATE OR REPLACE FUNCTION select_ping_tier(
  target_monitor_id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
RETURNS TABLE (
  ts TIMESTAMPTZ,
  response_time_ms NUMERIC,
  min_time_ms INTEGER,
  max_time_ms INTEGER,
  p95_time_ms INTEGER,
  sample_count INTEGER,
  status_code INTEGER,
  source_tier TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM select_ping_tier_for_team(current_team_id(), target_monitor_id, start_time, end_time);
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Policies target the `authenticated` role only. The worker connects over the
-- direct Postgres URL as `postgres`, and the register route uses the service
-- role key — both bypass these policies by design.
-- ---------------------------------------------------------------------------

ALTER TABLE teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_webhooks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_raw   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE ping_logs_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views     ENABLE ROW LEVEL SECURITY;

-- Worker-internal bookkeeping. RLS on with no policy = no client access at all.
ALTER TABLE rollup_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_queue  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_teams ON teams;
CREATE POLICY tenant_isolation_teams ON teams
  FOR ALL TO authenticated USING (id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_monitors ON monitors;
CREATE POLICY tenant_isolation_monitors ON monitors
  FOR ALL TO authenticated
  USING (team_id = current_team_id())
  WITH CHECK (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_incidents ON incidents;
CREATE POLICY tenant_isolation_incidents ON incidents
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_team_webhooks ON team_webhooks;
CREATE POLICY tenant_isolation_team_webhooks ON team_webhooks
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_raw ON ping_logs_raw;
CREATE POLICY tenant_isolation_raw ON ping_logs_raw
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_hourly ON ping_logs_hourly;
CREATE POLICY tenant_isolation_hourly ON ping_logs_hourly
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_daily ON ping_logs_daily;
CREATE POLICY tenant_isolation_daily ON ping_logs_daily
  FOR ALL TO authenticated USING (team_id = current_team_id());

DROP POLICY IF EXISTS tenant_isolation_views ON saved_views;
CREATE POLICY tenant_isolation_views ON saved_views
  FOR ALL TO authenticated USING (team_id = current_team_id());
