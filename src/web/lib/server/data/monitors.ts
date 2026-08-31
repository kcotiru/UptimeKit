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

export interface TierRow {
  /** Named `ts` in SQL — an output column named `timestamp` is a Postgres syntax error. */
  ts: string;
  response_time_ms: number;
  status_code: number | null;
  source_tier: string;
}

export function toPingMetric(row: TierRow): PingMetric {
  return {
    timestamp: row.ts,
    responseTimeMs: Math.round(Number(row.response_time_ms)),
    statusCode: row.status_code,
    // Rolled-up tiers average away individual failures, so only raw rows can
    // report a point as down.
    isUp: row.source_tier !== 'raw' || (row.status_code !== null && row.status_code < 400),
  };
}
