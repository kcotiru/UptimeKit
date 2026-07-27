/**
 * Tier-aware ping log query functions for UptimeKit.
 */

-- Select ping metrics automatically routing across raw, hourly, and daily tiers
CREATE OR REPLACE FUNCTION select_ping_tier(
  target_monitor_id UUID,
  target_team_id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
RETURNS TABLE (
  timestamp TIMESTAMPTZ,
  response_time_ms NUMERIC,
  min_time_ms INTEGER,
  max_time_ms INTEGER,
  p95_time_ms INTEGER,
  sample_count INTEGER,
  source_tier TEXT
) AS $$
DECLARE
  now_ts TIMESTAMPTZ := NOW();
  raw_cutoff TIMESTAMPTZ := now_ts - INTERVAL '7 days';
  hourly_cutoff TIMESTAMPTZ := now_ts - INTERVAL '90 days';
BEGIN
  RETURN QUERY
  -- Tier 1: Raw data (< 7 days)
  SELECT 
    r.timestamp AS timestamp,
    r.response_time_ms::NUMERIC AS response_time_ms,
    r.response_time_ms AS min_time_ms,
    r.response_time_ms AS max_time_ms,
    r.response_time_ms AS p95_time_ms,
    1 AS sample_count,
    'raw'::TEXT AS source_tier
  FROM ping_logs_raw r
  WHERE r.monitor_id = target_monitor_id
    AND r.team_id = target_team_id
    AND r.timestamp >= start_time
    AND r.timestamp <= end_time
    AND r.timestamp >= raw_cutoff

  UNION ALL

  -- Tier 2: Hourly data (7 days to 90 days)
  SELECT 
    h.hour_timestamp AS timestamp,
    h.avg_time_ms AS response_time_ms,
    h.min_time_ms,
    h.max_time_ms,
    h.p95_time_ms,
    h.sample_count,
    'hourly'::TEXT AS source_tier
  FROM ping_logs_hourly h
  WHERE h.monitor_id = target_monitor_id
    AND h.team_id = target_team_id
    AND h.hour_timestamp >= start_time
    AND h.hour_timestamp <= end_time
    AND h.hour_timestamp < raw_cutoff
    AND h.hour_timestamp >= hourly_cutoff

  UNION ALL

  -- Tier 3: Daily data (> 90 days)
  SELECT 
    d.day_timestamp AS timestamp,
    d.avg_time_ms AS response_time_ms,
    d.min_time_ms,
    d.max_time_ms,
    d.p95_time_ms,
    d.sample_count,
    'daily'::TEXT AS source_tier
  FROM ping_logs_daily d
  WHERE d.monitor_id = target_monitor_id
    AND d.team_id = target_team_id
    AND d.day_timestamp >= start_time
    AND d.day_timestamp <= end_time
    AND d.day_timestamp < hourly_cutoff

  ORDER BY timestamp ASC;
END;
$$ LANGUAGE plpgsql;
