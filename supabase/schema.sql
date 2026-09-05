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
  -- Not enforced anywhere in application code yet. Kept because dropping shipped
  -- columns buys nothing; do not read them as a working billing tier.
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
-- pg_temp is searched before anything named here even when omitted from the
-- path, so it must be listed explicitly: without it, any role can shadow
-- `users` with a pg_temp.users carrying an attacker-chosen team_id, and since
-- every RLS policy in this schema calls current_team_id(), that's a full
-- tenant takeover, not just a leak from this one function.
CREATE OR REPLACE FUNCTION current_team_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- Records where a daily row's percentiles actually came from. 'raw' means they
-- are exact: the day's raw rows were still present AND complete (their count
-- matched the hourly buckets' summed total_pings), so PERCENTILE_CONT ran over
-- the real sample. 'hourly_approx' means the raw rows were gone or partial and
-- the row carries percentiles OF hourly percentiles, whose error is unbounded.
-- ALTER rather than a CREATE TABLE edit: the table already exists on deployed
-- projects, and schema.sql must stay re-runnable.
ALTER TABLE ping_logs_daily
  ADD COLUMN IF NOT EXISTS percentile_source TEXT NOT NULL DEFAULT 'hourly_approx';

DO $$
BEGIN
  ALTER TABLE ping_logs_daily
    ADD CONSTRAINT ping_logs_daily_percentile_source_check
    CHECK (percentile_source IN ('raw', 'hourly_approx'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

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
-- pg_temp must be listed explicitly in search_path (see current_team_id()
-- above) — otherwise a poisoned pg_temp.deletion_queue silently swallows
-- purge enqueues instead of erroring, and the monitor's data never gets
-- reaped.
CREATE OR REPLACE FUNCTION enqueue_monitor_purge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- base64url: Postgres has no built-in encoder for it, so translate the two
-- URL-unsafe characters out of standard base64 and strip the padding.
-- 32 random bytes -> 43 characters, 256 bits of entropy.
-- gen_random_bytes() is pgcrypto's. Supabase installs pgcrypto into the
-- `extensions` schema, not `public`; a stock/local Postgres install puts it in
-- `public`. Both are named so this resolves on either. pg_temp is listed too,
-- same reasoning as current_team_id() above.
CREATE OR REPLACE FUNCTION gen_share_token()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

-- Added after the table shipped, so ALTER rather than table fields.
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS monitor_id UUID REFERENCES monitors(id);
-- Revoke kills a leaked link without destroying the saved window.
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE saved_views ALTER COLUMN share_token SET DEFAULT gen_share_token();
-- A saved view outliving the person who created it is correct behaviour
-- (e.g. the creator leaves the team), so creator_id must not block that.
ALTER TABLE saved_views ALTER COLUMN creator_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_views_monitor_id ON saved_views(monitor_id);
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
-- search_path pinned for the same reason as the definer functions above, even
-- though these three are INVOKER: they build DDL with format() against
-- unqualified names, and pg_temp is searched first for relations unless it is
-- named explicitly. Supabase's linter flags the unpinned form
-- (0011_function_search_path_mutable), and every other function in this file
-- already pins it — leaving three exceptions is how the next reader concludes
-- the rule is optional.
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

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
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

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
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

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

-- ---------------------------------------------------------------------------
-- Tier-aware metric read (raw < 7d, hourly < 90d, daily beyond)
-- ---------------------------------------------------------------------------

-- The three-tier read, with the tenant as a parameter. SECURITY INVOKER, so an
-- authenticated caller passing another team's UUID still hits RLS on the
-- ping_logs_* tables and gets nothing. Called from get_shared_view (which is
-- SECURITY DEFINER), the invoker is the definer's role and RLS is bypassed —
-- that is the whole point of the split. pg_temp is pinned below even though
-- this function is INVOKER, not DEFINER: it runs inside get_shared_view's
-- definer context, so its search_path is part of that same boundary.
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
$$ LANGUAGE plpgsql STABLE SET search_path = public, pg_temp;

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

-- The public share path. SECURITY DEFINER because an anonymous caller has no
-- JWT, so auth.uid() and therefore current_team_id() are NULL and every RLS
-- policy denies. The share token IS the authorization: 256 bits of entropy,
-- revocable, and scoped to exactly one monitor and one window.
--
-- Deliberately narrow: one TEXT parameter, no dynamic SQL, pinned search_path,
-- and monitors.url is never selected — the redaction is enforced here, in SQL,
-- not in the React component that renders the result.
CREATE OR REPLACE FUNCTION get_shared_view(token TEXT)
RETURNS TABLE (
  view_name TEXT,
  monitor_name TEXT,
  monitor_status TEXT,
  window_from TIMESTAMPTZ,
  window_to TIMESTAMPTZ,
  ts TIMESTAMPTZ,
  response_time_ms NUMERIC,
  min_time_ms INTEGER,
  max_time_ms INTEGER,
  p95_time_ms INTEGER,
  sample_count INTEGER,
  source_tier TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- pg_temp is searched BEFORE anything named here even when omitted, so it
-- must be listed explicitly — otherwise a caller with no privileges beyond
-- EXECUTE can shadow saved_views/monitors with pg_temp tables of the same
-- name and feed this definer-rights function whatever rows it wants.
-- TimeZone is pinned for the same reason rollup-processor.ts pins it before
-- rollups (see SET LOCAL TIME ZONE 'UTC' there): date_trunc follows the
-- session zone, so an unpinned session changes which bucket a window snaps
-- to depending on who's connected.
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
DECLARE
  v RECORD;
  w_from TIMESTAMPTZ;
  w_to TIMESTAMPTZ;
  snap_from TIMESTAMPTZ;
  snap_to TIMESTAMPTZ;
BEGIN
  SELECT sv.name AS v_name,
         sv.team_id,
         sv.monitor_id,
         sv.configuration->>'from' AS raw_from,
         sv.configuration->>'to' AS raw_to,
         m.name AS m_name,
         m.status AS m_status
    INTO v
    FROM saved_views sv
    -- team_id must be pinned on the join, not just checked later: without it
    -- a saved_views row can point at another team's monitor_id (nothing FKs
    -- ping_logs_raw.monitor_id, and its RLS only checks team_id) and publish
    -- that victim's monitor name and live status through this token.
    JOIN monitors m ON m.id = sv.monitor_id AND m.team_id = sv.team_id
   WHERE sv.share_token = token
     AND sv.revoked_at IS NULL
     AND m.is_deleted = false;

  -- One empty result for unknown, revoked, and deleted alike: the caller learns
  -- nothing about which case it hit.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A malformed configuration (bad JSON value under 'from'/'to') must fail
  -- the same way as an unknown token: no cast error text leaking table/column
  -- names to an anonymous caller, no existence oracle from the error/no-error
  -- split.
  BEGIN
    w_from := v.raw_from::TIMESTAMPTZ;
    w_to   := v.raw_to::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  -- Retention coarsens the data under a fixed window. Without widening, a
  -- 02:00-06:00 window served by midnight-stamped daily buckets returns
  -- nothing at all — blank, not blurry. The upper bound is NOT pushed a
  -- further bucket out: select_ping_tier_for_team's BETWEEN is inclusive, and
  -- date_trunc(unit, w_to) already lands in the bucket containing w_to, so
  -- adding another unit would publish one whole extra bucket the sharer never
  -- pinned.
  IF w_from < NOW() - INTERVAL '90 days' THEN
    snap_from := date_trunc('day', w_from);
    snap_to   := date_trunc('day', w_to);
  ELSIF w_from < NOW() - INTERVAL '7 days' THEN
    snap_from := date_trunc('hour', w_from);
    snap_to   := date_trunc('hour', w_to);
  ELSE
    snap_from := w_from;
    snap_to   := w_to;
  END IF;

  -- LEFT JOIN LATERAL against a one-row anchor: a valid view always yields at
  -- least its header row, with the series columns NULL when the pinned window
  -- holds no data. Without this, a quiet or retention-emptied window returned
  -- zero rows and the page 404'd a link that was perfectly valid.
  --
  -- This does hand back a token-VALIDITY oracle, which the earlier design
  -- deliberately avoided. The trade is deliberate and bounded: share_token is
  -- 43 base64url characters over 256 bits from gen_random_bytes, so an attacker
  -- has no way to produce a candidate token to ask about, and an oracle that
  -- cannot be queried with a plausible guess is not a practical exposure. The
  -- one caller who CAN exercise the oracle is the legitimate token holder —
  -- they already have a valid token, so the only new thing they learn is
  -- which of "revoked" or "valid but the window emptied" they're looking at,
  -- and that is accepted.
  --
  -- The cases that still reveal nothing are the ones that would matter —
  -- unknown, revoked, soft-deleted monitor, and cross-tenant all return zero
  -- rows above, and must keep doing so. Cross-tenant (a saved_views row
  -- pointing at another team's monitor_id) is blocked solely by the
  -- `m.team_id = sv.team_id` join above — before this change
  -- select_ping_tier_for_team's own team filter already returned nothing for
  -- a mismatched monitor regardless, so that join has always been the real
  -- barrier; a future editor loosening it would now leak the victim's monitor
  -- name and live status with nothing behind it.
  --
  -- A malformed window (bad cast input) still returns zero rows via the
  -- EXCEPTION block above. A reversed window (snap_from > snap_to) is NOT in
  -- that list: it now returns a header row with an empty series, like any
  -- other window that simply holds no data, rather than zero rows.
  RETURN QUERY
  SELECT
    v.v_name::TEXT,
    v.m_name::TEXT,
    v.m_status::TEXT,
    w_from,
    w_to,
    t.ts,
    t.response_time_ms,
    t.min_time_ms,
    t.max_time_ms,
    t.p95_time_ms,
    t.sample_count,
    t.source_tier
  FROM (SELECT 1) AS anchor
  LEFT JOIN LATERAL
    select_ping_tier_for_team(v.team_id, v.monitor_id, snap_from, snap_to) t ON TRUE;
END;
$$;

-- Functions are executable by PUBLIC by default; narrow that deliberately.
REVOKE ALL ON FUNCTION get_shared_view(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_shared_view(TEXT) TO anon, authenticated;

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

-- @local-test:strip-start (pg_cron)
-- ---------------------------------------------------------------------------
-- Partition maintenance schedule (pg_cron)
--
-- Deliberately LAST in this file. This block is the one statement in
-- schema.sql that fails on a project where pg_cron is unavailable, and under
-- `psql -f` without ON_ERROR_STOP, a failing statement does not stop the
-- script — everything after it silently never runs. Every ENABLE ROW LEVEL
-- SECURITY and every tenant-isolation policy above must land before this
-- block has any chance to throw, so an unavailable extension can never leave
-- a table with RLS disabled.
-- Idempotent: create_daily_partition is CREATE TABLE IF NOT EXISTS, and the
-- unschedule/schedule pair means re-running this file does not stack duplicate jobs.
--
-- The sentinel comments below fence the whole region.
-- tests/integration/helpers/db-setup.ts strips everything between them before
-- applying this file to a local Postgres, which has no pg_cron. Keep every
-- `cron.` reference inside the fence.
-- ---------------------------------------------------------------------------

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

-- Assert the postcondition. Without this, a partially provisioned extension
-- that leaves cron.schedule() returning but no row landing in cron.job would
-- leave partition maintenance unscheduled and silent, and ping_logs_raw stops
-- accepting inserts about 30 days later. Failing the schema apply is the loud
-- alternative. This does NOT catch pg_cron installed into a database its
-- background worker doesn't poll — that is caught separately below, since
-- cron.job would still contain the row in that case.
DO $$
BEGIN
  IF current_setting('cron.database_name', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION
      'pg_cron polls database "%" but this schema was applied to "%" — uptimekit-partitions will never run',
      current_setting('cron.database_name', true), current_database();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'uptimekit-partitions'
  ) THEN
    RAISE EXCEPTION
      'uptimekit-partitions is not registered in cron.job — partition maintenance is NOT scheduled; ping_logs_raw will stop accepting inserts once the pre-created partitions run out';
  END IF;
END $$;
-- @local-test:strip-end
