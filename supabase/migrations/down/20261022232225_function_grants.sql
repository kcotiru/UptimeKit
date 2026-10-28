-- Undoes 20261022232225_function_grants.sql: hands the EXECUTE grant on both
-- functions back to PUBLIC, and restores select_ping_tier with the search_path
-- it had in the baseline.
--
-- Granting to PUBLIC is what the forward migration exists to end, so this file
-- re-opens the RPC endpoints Supabase's advisor flagged. It is here because the
-- runner requires a down twin, not because reverting is a good idea on a live
-- project.
--
-- Granting PUBLIC also covers `anon`, `authenticated` and `service_role`, which
-- is exactly the state a freshly created function is in, so their explicit
-- entries are not restored one by one. The forward file's REVOKE collapsed the
-- live project's five-entry ACL into the owner's entry plus the one re-grant,
-- and nothing short of re-running Supabase's provisioning would reproduce the
-- original five; PUBLIC subsumes all of them for the EXECUTE privilege, which
-- is the only privilege a function has.
GRANT EXECUTE ON FUNCTION enqueue_monitor_purge() TO PUBLIC;

-- The forward file's re-grant to `authenticated` is left in place. PUBLIC
-- already covers it, and revoking it here would make this revert the one thing
-- a revert must never be, which is an outage: every RLS policy calls this
-- function.
GRANT EXECUTE ON FUNCTION current_team_id() TO PUBLIC;

-- PUBLIC gets EXECUTE back. Not literally the state before the forward
-- migration, which was proacl = NULL, the inherited grant a function is created
-- with: this leaves a materialized ACL carrying an explicit `=X` entry for
-- PUBLIC instead. The two are equivalent in what they permit, and once an ACL
-- has been materialized no GRANT can take it back to NULL.
--
-- The explicit entries the forward file added for `anon` and `authenticated` are
-- left in place, for the same reason as the re-grant above: PUBLIC already
-- covers them, and the register page calls this function anonymously, so a
-- revert that narrowed it would break that page.
GRANT EXECUTE ON FUNCTION describe_invite(TEXT) TO PUBLIC;

-- schema.sql:500-525 verbatim, pg_temp absent from the path, which is the
-- inconsistency the forward migration fixed.
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
  source_tier TEXT,
  success_count INTEGER,
  p50_time_ms INTEGER,
  p99_time_ms INTEGER,
  percentile_source TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM select_ping_tier_for_team(current_team_id(), target_monitor_id, start_time, end_time);
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
