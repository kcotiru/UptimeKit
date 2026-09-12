import { notFound } from 'next/navigation';
import { getSharedView } from '@/lib/server/data/saved-views';
import { supabaseAnon } from '@/lib/server/supabase';
import { StatusWord } from '@/components/monitors/status-badge';
import { StatRow } from '@/components/monitors/stat-row';
import { TierNote } from '@/components/monitors/tier-note';
import { MetricTabs } from '@/components/monitors/metric-tabs';
import { summarize } from '@/lib/shared/stats';
import { formatDate } from '@/lib/shared/utils';
import type { PingMetric, SharedViewPoint, Tier } from '@/lib/shared/types';

/** A shared point carries no status code — get_shared_view never returns one —
 *  so a public chart cannot distinguish up from down and does not try. */
function toChartPoint(point: SharedViewPoint, tier: string): PingMetric {
  return {
    timestamp: point.timestamp,
    responseTimeMs: point.responseTimeMs,
    statusCode: null,
    isUp: true,
    minMs: point.minMs,
    maxMs: point.maxMs,
    p95Ms: point.p95Ms,
    sampleCount: point.sampleCount,
    sourceTier: tier as PingMetric['sourceTier'],
    successCount: point.successCount,
    p50Ms: point.p50Ms,
    p99Ms: point.p99Ms,
    percentileSource: point.percentileSource,
  };
}

// Token-scoped and retention-sensitive — never prerender or cache.
export const dynamic = 'force-dynamic';

/**
 * Public, session-free view of one pinned window. Deliberately shows the monitor
 * name but not its URL: get_shared_view does not return one, so there is nothing
 * here to leak even if this component were changed carelessly.
 */
export default async function SharedViewPage({ params }: { params: { token: string } }) {
  const shared = await getSharedView(supabaseAnon(), params.token).catch((error: unknown) => {
    console.error('Failed to load shared view:', error instanceof Error ? error.message : error);
    return null;
  });

  // Unknown, revoked, and purged all land here — the visitor learns nothing
  // about which, matching what the SQL function chooses to reveal.
  if (!shared) {
    notFound();
  }

  const metrics = shared.points.map((p) => toChartPoint(p, shared.sourceTier));
  const tier = shared.sourceTier as Tier;
  const stats = summarize(metrics, tier);

  return (
    <div className="min-h-screen bg-background text-slate-100 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-surface border border-surface-border rounded-lg p-6 space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">
              {shared.monitorName}
            </h1>
            <StatusWord status={shared.monitorStatus} />
          </div>
          <p className="text-sm text-slate-400">{shared.viewName}</p>
          <p className="text-xs text-slate-500">
            {formatDate(shared.from)} — {formatDate(shared.to)}
          </p>
          <TierNote tier={tier} />
        </div>

        {shared.points.length === 0 ? (
          <div
            className="w-full bg-surface/50 border border-surface-border border-dashed rounded-lg p-8 text-center text-sm text-slate-400"
            style={{ height: 320 }}
          >
            Nothing was recorded in this window.
          </div>
        ) : (
          <>
            {stats && <StatRow stats={stats} />}
            <MetricTabs metrics={metrics} />
          </>
        )}

        <p className="text-[11px] text-slate-600 text-center">Shared from UptimeKit</p>
      </div>
    </div>
  );
}
