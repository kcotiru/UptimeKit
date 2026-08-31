import { notFound } from 'next/navigation';
import { getSharedView } from '@/lib/server/data/saved-views';
import { supabaseAnon } from '@/lib/server/supabase';
import { StatusBadge } from '@/components/monitors/status-badge';
import { TimeSeriesChart } from '@/components/monitors/time-series-chart';
import { formatDate } from '@/lib/shared/utils';

// Token-scoped and retention-sensitive — never prerender or cache.
export const dynamic = 'force-dynamic';

const TIER_NOTE: Record<string, string> = {
  hourly: 'Showing hourly averages — raw samples for this window have been rolled up.',
  daily: 'Showing daily averages. Percentiles at this range are approximate.',
};

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

  const metrics = shared.points.map((point) => ({
    timestamp: point.timestamp,
    responseTimeMs: point.responseTimeMs,
    statusCode: null,
    isUp: true,
  }));

  return (
    <div className="min-h-screen bg-background text-slate-100 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">
              {shared.monitorName}
            </h1>
            <StatusBadge status={shared.monitorStatus} />
          </div>
          <p className="text-sm text-slate-400">{shared.viewName}</p>
          <p className="text-xs text-slate-500 font-mono">
            {formatDate(shared.from)} — {formatDate(shared.to)}
          </p>
          {TIER_NOTE[shared.sourceTier] && (
            <p className="text-[11px] text-amber-400/90">{TIER_NOTE[shared.sourceTier]}</p>
          )}
        </div>

        {shared.points.length === 0 ? (
          <div
            className="w-full bg-surface/50 border border-surface-border border-dashed rounded-2xl p-8 text-center text-sm text-slate-400"
            style={{ height: 320 }}
          >
            No response data was recorded in this window.
          </div>
        ) : (
          <TimeSeriesChart metrics={metrics} />
        )}

        <p className="text-[11px] text-slate-600 text-center">Shared from UptimeKit</p>
      </div>
    </div>
  );
}
