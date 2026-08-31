import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MonitorStatus, SavedView, SharedView } from '../../shared/types';
import { createSavedViewSchema } from '../../shared/validations/saved-view';

const VIEW_COLUMNS =
  'id, team_id, monitor_id, creator_id, name, configuration, share_token, revoked_at, created_at';

interface SavedViewRow {
  id: string;
  team_id: string;
  monitor_id: string;
  creator_id: string | null;
  name: string;
  configuration: { from?: string; to?: string };
  share_token: string;
  revoked_at: string | null;
  created_at: string;
}

export function toSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    teamId: row.team_id,
    monitorId: row.monitor_id,
    creatorId: row.creator_id,
    name: row.name,
    from: row.configuration?.from ?? '',
    to: row.configuration?.to ?? '',
    shareToken: row.share_token,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export interface SharedViewRow {
  view_name: string;
  monitor_name: string;
  monitor_status: string;
  window_from: string;
  window_to: string;
  // Null on the header row a valid-but-empty window returns.
  ts: string | null;
  response_time_ms: number | null;
  min_time_ms: number | null;
  max_time_ms: number | null;
  p95_time_ms: number | null;
  sample_count: number | null;
  source_tier: string | null;
}

// Coarsest wins: if any point came from daily buckets, the whole chart is only
// as trustworthy as daily buckets, and the page says so.
const TIER_RANK: Record<string, number> = { raw: 0, hourly: 1, daily: 2 };

/**
 * Folds the function's flat rows — which repeat the view header on every point —
 * into one object. Returns null for zero rows, which is what an unknown,
 * revoked, deleted-monitor, cross-tenant, or malformed-window (bad cast
 * input) token yields; the caller renders a 404, not an error. A valid view
 * whose pinned window holds no data — including a reversed window, where
 * snap_from > snap_to — comes back as a single header row with every series
 * column null — that yields an empty `points` array, not null.
 */
export function toSharedView(rows: SharedViewRow[]): SharedView | null {
  if (rows.length === 0) return null;
  const head = rows[0];

  // A valid view whose window holds no data comes back as a single header row
  // with every series column null. Zero rows still means
  // unknown/revoked/deleted-monitor/cross-tenant/malformed-window.
  const series = rows.filter(
    (r): r is SharedViewRow & {
      ts: string;
      p95_time_ms: number;
      sample_count: number;
      source_tier: string;
    } => r.ts !== null
  );

  // An empty window has no tier at all — '' matches no TIER_NOTE, so the page
  // renders no tier label rather than a misleading one.
  const sourceTier = series.reduce(
    (worst, r) => ((TIER_RANK[r.source_tier] ?? 0) > (TIER_RANK[worst] ?? 0) ? r.source_tier : worst),
    series[0]?.source_tier ?? ''
  );

  return {
    viewName: head.view_name,
    monitorName: head.monitor_name,
    monitorStatus: (head.monitor_status === 'paused'
      ? 'unknown'
      : head.monitor_status) as MonitorStatus,
    from: head.window_from,
    to: head.window_to,
    sourceTier,
    points: series.map((r) => ({
      timestamp: r.ts,
      responseTimeMs: Math.round(Number(r.response_time_ms)),
      p95Ms: r.p95_time_ms,
      sampleCount: r.sample_count,
    })),
  };
}

/** Lists the signed-in team's saved views. Row level security scopes the result. */
export async function listSavedViews(db: SupabaseClient): Promise<SavedView[]> {
  const { data, error } = await db
    .from('saved_views')
    .select(VIEW_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toSavedView);
}

/**
 * Validates and inserts a saved view. share_token is omitted deliberately — the
 * column defaults to gen_share_token(), so the secret is generated in the
 * database and never passes through application code.
 */
export async function createSavedView(
  db: SupabaseClient,
  input: unknown,
  teamId: string,
  creatorId: string
): Promise<SavedView> {
  const parsed = createSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid saved view');
  }

  const { data, error } = await db
    .from('saved_views')
    .insert({
      team_id: teamId,
      monitor_id: parsed.data.monitorId,
      creator_id: creatorId,
      name: parsed.data.name,
      configuration: { from: parsed.data.from, to: parsed.data.to },
    })
    .select(VIEW_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toSavedView(data);
}

/** Kills a share link without destroying the window. Idempotent. */
export async function revokeSavedView(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db
    .from('saved_views')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id');

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Hard delete — saved views carry no history worth soft-deleting. */
export async function deleteSavedView(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db.from('saved_views').delete().eq('id', id).select('id');

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/**
 * The anonymous read. `db` must be an anon-key client, not a session-bound one —
 * this runs for visitors with no account. Authorization is the token itself,
 * checked inside get_shared_view.
 */
export async function getSharedView(
  db: SupabaseClient,
  token: string
): Promise<SharedView | null> {
  const { data, error } = await db.rpc('get_shared_view', { token });

  if (error) throw new Error(error.message);
  return toSharedView((data ?? []) as SharedViewRow[]);
}
