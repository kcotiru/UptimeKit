import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Monitor, PingMetric } from '../../shared/types';
import { createMonitorSchema } from '../../shared/validations/monitor';

const MONITOR_COLUMNS = 'id, team_id, name, url, check_interval, timeout_ms, status, created_at, updated_at';

interface MonitorRow {
  id: string;
  team_id: string;
  name: string;
  url: string;
  check_interval: number;
  timeout_ms: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export function toMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    url: row.url,
    intervalSeconds: row.check_interval,
    timeoutMs: row.timeout_ms,
    status: row.status === 'paused' ? 'unknown' : (row.status as Monitor['status']),
    // The worker touches updated_at on every ping, so it doubles as last-checked.
    lastCheckedAt: row.updated_at ?? null,
    createdAt: row.created_at,
  };
}

/** Lists the signed-in team's monitors. Row level security scopes the result. */
export async function listMonitors(db: SupabaseClient): Promise<Monitor[]> {
  const { data, error } = await db
    .from('monitors')
    .select(MONITOR_COLUMNS)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toMonitor);
}

export async function getMonitor(db: SupabaseClient, id: string): Promise<Monitor | null> {
  const { data, error } = await db
    .from('monitors')
    .select(MONITOR_COLUMNS)
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toMonitor(data) : null;
}

/**
 * Validates and inserts a monitor. Input is re-validated server side — the
 * client-side check in the form is a convenience, not a trust boundary.
 * Monitors start paused; the worker flips status on its first ping.
 */
export async function createMonitor(db: SupabaseClient, input: unknown): Promise<Monitor> {
  const parsed = createMonitorSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid monitor');
  }

  const { data, error } = await db
    .from('monitors')
    .insert({
      name: parsed.data.name,
      url: parsed.data.url,
      check_interval: parsed.data.intervalSeconds,
      timeout_ms: parsed.data.timeoutMs,
    })
    .select(MONITOR_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toMonitor(data);
}

/** Soft deletes a monitor. Returns false when it does not exist for this team. */
export async function deleteMonitor(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db
    .from('monitors')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('is_deleted', false)
    .select('id');

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Time-series points for a monitor, routed across the raw/hourly/daily tiers. */
export async function getMetrics(db: SupabaseClient, id: string, from: string, to: string): Promise<PingMetric[]> {
  const { data, error } = await db.rpc('select_ping_tier', {
    target_monitor_id: id,
    start_time: from,
    end_time: to,
  });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toPingMetric);
}

/**
 * Recent raw samples for every monitor on the team, keyed by monitor id.
 *
 * One query rather than one per monitor: the `tenant_isolation_raw` policy on
 * ping_logs_raw already scopes reads to the caller's team, so a single read is
 * both correct and cheap.
 *
 * ponytail: fixed short window, thinned in JS. A team with hundreds of monitors
 * on 30s intervals would want a bucketed SQL query instead.
 */
export async function listRecentMetrics(
  db: SupabaseClient,
  sinceISO: string
): Promise<Map<string, PingMetric[]>> {
  const { data, error } = await db
    .from('ping_logs_raw')
    .select('monitor_id, timestamp, response_time_ms, status_code')
    .gte('timestamp', sinceISO)
    .order('timestamp', { ascending: true });

  if (error) throw new Error(error.message);

  const byMonitor = new Map<string, PingMetric[]>();
  for (const row of data ?? []) {
    const list = byMonitor.get(row.monitor_id) ?? [];
    const isUp = row.status_code !== null && row.status_code < 400;
    list.push({
      timestamp: row.timestamp,
      responseTimeMs: Math.round(Number(row.response_time_ms)),
      statusCode: row.status_code,
      isUp,
      minMs: null,
      maxMs: null,
      p95Ms: null,
      sampleCount: 1,
      sourceTier: 'raw',
      successCount: isUp ? 1 : 0,
      p50Ms: Math.round(Number(row.response_time_ms)),
      p99Ms: Math.round(Number(row.response_time_ms)),
      percentileSource: 'raw',
    });
    byMonitor.set(row.monitor_id, list);
  }

  return byMonitor;
}

export interface TierRow {
  /** Named `ts` in SQL — an output column named `timestamp` is a Postgres syntax error. */
  ts: string;
  response_time_ms: number;
  min_time_ms: number | null;
  max_time_ms: number | null;
  p95_time_ms: number | null;
  sample_count: number | null;
  status_code: number | null;
  source_tier: string;
  success_count: number | null;
  p50_time_ms: number | null;
  p99_time_ms: number | null;
  percentile_source: string | null;
}

export function toPingMetric(row: TierRow): PingMetric {
  return {
    timestamp: row.ts,
    responseTimeMs: Math.round(Number(row.response_time_ms)),
    statusCode: row.status_code,
    // Rolled-up tiers average away individual failures, so only raw rows can
    // report a point as down.
    isUp: row.source_tier !== 'raw' || (row.status_code !== null && row.status_code < 400),
    minMs: row.min_time_ms,
    maxMs: row.max_time_ms,
    p95Ms: row.p95_time_ms,
    sampleCount: row.sample_count ?? 1,
    sourceTier: row.source_tier as PingMetric['sourceTier'],
    successCount: row.success_count ?? 0,
    p50Ms: row.p50_time_ms,
    p99Ms: row.p99_time_ms,
    percentileSource: row.percentile_source,
  };
}
