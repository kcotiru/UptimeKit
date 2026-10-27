-- Narrow the EXECUTE grants on the SECURITY DEFINER functions Supabase's
-- security advisor flags: `enqueue_monitor_purge`, `current_team_id` and
-- `describe_invite`. A function is executable by PUBLIC from the moment it is
-- created, so all three inherited that grant rather than being given it.
--
-- The ACL entry that matters is the one with an empty grantee. Read from
-- pg_proc.proacl on the live project, all three carry
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- and that leading `=X/postgres` is the grant to PUBLIC. A revoke naming only
-- `anon` and `authenticated` leaves it behind, so nothing changes and the
-- migration is a no-op that reads like a fix. `get_shared_view` is the
-- counter-example already in the schema: it has no such entry, because
-- schema.sql:683-684 revokes from PUBLIC first and then grants the two roles
-- that need it. That is the pattern this file copies.
--
-- The named roles are revoked as well, not instead: on the live project they
-- hold their own explicit entries, which a revoke of PUBLIC alone would not
-- touch. `service_role` keeps its entry deliberately. It is the server-side
-- key, it already bypasses RLS by design, and taking it away would be a change
-- this migration was not asked to make.
--
-- Deliberately NOT touched: select_ping_tier and select_ping_tier_for_team keep
-- their PUBLIC grants. Both are SECURITY INVOKER, so RLS governs every row they
-- return and the EXECUTE grant buys an anonymous caller nothing. The definer
-- and invoker split is the whole criterion here, not tidiness.

-- The trigger function, and the one of the three where the grant was hygiene
-- rather than a hole. PostgREST does not publish a function returning `trigger`
-- as an RPC endpoint at all: a POST to /rest/v1/rpc/enqueue_monitor_purge
-- answers 404 PGRST202, with the PUBLIC grant in place or without it, verified
-- both ways against a local stack. So this REVOKE closes nothing that was
-- reachable over the API. It is still worth making, because the grant serves
-- nothing (a bare `SELECT enqueue_monitor_purge()` cannot work either, since a
-- trigger function has no NEW record outside a trigger) and clearing it removes
-- an advisor finding.
--
-- Nothing is granted back. Postgres checks EXECUTE on a trigger function when
-- CREATE TRIGGER runs rather than each time the trigger fires, so
-- monitors_enqueue_purge keeps working with no grant left at all.
REVOKE ALL ON FUNCTION enqueue_monitor_purge() FROM PUBLIC, anon, authenticated;

-- The tenant key. Every RLS policy in this schema calls current_team_id(), and
-- a policy expression evaluates as the querying role, not as the policy's
-- author. So the re-grant on the next line is not tidiness: without it every
-- query the web app makes fails on EXECUTE and the application stops serving.
-- `anon` is revoked and never granted back, which is the point of the change:
-- an anonymous caller has no JWT, so auth.uid() is NULL, the function returns
-- NULL, and the only thing it can be used for over the API is confirming that.
-- The anonymous read path that does exist, get_shared_view(), is SECURITY
-- DEFINER and calls this function as its owner, so it is unaffected.
REVOKE ALL ON FUNCTION current_team_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_team_id() TO authenticated;

-- The invite preview. Unlike the two above, `anon` reaching this one is the
-- point: register-form.tsx:32 calls it over RPC from the browser to name the
-- team behind an invite link, before the visitor has an account at all. So the
-- change here is posture, not access. An inherited PUBLIC grant and a
-- deliberate grant to the two roles that need it are not the same thing, even
-- where the effect on the application is nil, and the latter is what the
-- schema already does for the other anonymous entry point two functions over.
REVOKE ALL ON FUNCTION describe_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION describe_invite(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one search_path that omits pg_temp
-- ---------------------------------------------------------------------------

-- pg_temp is searched before anything a search_path names even when it is left
-- out of the list, so every function that pins a path has to name it or a
-- caller holding nothing beyond EXECUTE can shadow the relations the body
-- reads. Every other function in the schema names it; select_ping_tier
-- (schema.sql:524) is the only one that does not.
--
-- The body is schema.sql:500-525 unchanged apart from the path, so this replace
-- is behaviour preserving. The signature is unchanged too: the web app calls
-- this over RPC (src/web/lib/server/data/monitors.ts). CREATE OR REPLACE keeps
-- the function's existing ACL, so this does not quietly re-open or re-close
-- anything the statements above settled.
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
$$ LANGUAGE plpgsql STABLE SET search_path = public, pg_temp;
