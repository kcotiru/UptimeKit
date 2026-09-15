import { AlertCircle } from 'lucide-react';
import { listMonitors, listRecentMetrics } from '@/lib/server/data/monitors';
import { Header } from '@/components/layout/header';
import { MonitorList } from '@/components/monitors/monitor-list';
import { supabaseServer } from '@/lib/server/supabase';
import { RECENT_WINDOW_HOURS, formatRelative } from '@/lib/shared/utils';
import type { PingMetric } from '@/lib/shared/types';

// Per-user data behind a session cookie — never prerender.
export const dynamic = 'force-dynamic';

/**
 * React Server Component for the primary dashboard monitors list page.
 */
export default async function MonitorsPage() {
  let monitors: Awaited<ReturnType<typeof listMonitors>> = [];
  let recentMetrics: Map<string, PingMetric[]> = new Map();
  let loadFailed = false;

  try {
    monitors = await listMonitors(supabaseServer());
  } catch (error: unknown) {
    console.error('Failed to fetch monitors list:', error instanceof Error ? error.message : error);
    loadFailed = true;
  }

  try {
    recentMetrics = await listRecentMetrics(
      supabaseServer(),
      new Date(Date.now() - RECENT_WINDOW_HOURS * 3600 * 1000).toISOString()
    );
  } catch (error: unknown) {
    console.error('Failed to fetch recent metrics:', error instanceof Error ? error.message : error);
  }

  // A row alarms on anything other than 'up' (degraded counts too), so the
  // header count must match that, not just 'down'.
  const alarming = monitors.filter((m) => m.status !== 'up').length;

  // The Header's right slot exists for exactly this: one true, current fact.
  const lastChecked = monitors
    .map((m) => m.lastCheckedAt)
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1);

  return (
    <div className="space-y-6">
      <Header
        title="Monitors"
        subtitle={
          loadFailed
            ? 'Could not load your monitors'
            : monitors.length === 0
              ? 'Nothing being checked yet'
              : `${monitors.length} endpoint${monitors.length === 1 ? '' : 's'}, ${alarming} down`
        }
        meta={lastChecked ? `checked ${formatRelative(lastChecked)}` : undefined}
      />
      {loadFailed ? (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>Could not load your monitors. Try refreshing the page.</span>
        </div>
      ) : (
        <MonitorList
          initialMonitors={monitors}
          metricsByMonitor={Object.fromEntries(recentMetrics)}
        />
      )}
    </div>
  );
}
