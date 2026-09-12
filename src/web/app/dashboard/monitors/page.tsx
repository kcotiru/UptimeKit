import { listMonitors, listRecentMetrics } from '@/lib/server/data/monitors';
import { Header } from '@/components/layout/header';
import { MonitorList } from '@/components/monitors/monitor-list';
import { supabaseServer } from '@/lib/server/supabase';
import type { PingMetric } from '@/lib/shared/types';

// Per-user data behind a session cookie — never prerender.
export const dynamic = 'force-dynamic';

const RECENT_WINDOW_HOURS = 3;

/**
 * React Server Component for the primary dashboard monitors list page.
 */
export default async function MonitorsPage() {
  let monitors: Awaited<ReturnType<typeof listMonitors>> = [];
  let recentMetrics: Map<string, PingMetric[]> = new Map();

  try {
    monitors = await listMonitors(supabaseServer());
  } catch (error: unknown) {
    console.error('Failed to fetch monitors list:', error instanceof Error ? error.message : error);
  }

  try {
    recentMetrics = await listRecentMetrics(
      supabaseServer(),
      new Date(Date.now() - RECENT_WINDOW_HOURS * 3600 * 1000).toISOString()
    );
  } catch (error: unknown) {
    console.error('Failed to fetch recent metrics:', error instanceof Error ? error.message : error);
  }

  return (
    <div className="space-y-6">
      <Header
        title="Monitors"
        subtitle={
          monitors.length === 0
            ? 'Nothing being checked yet'
            : `${monitors.length} endpoint${monitors.length === 1 ? '' : 's'}, ${
                monitors.filter((m) => m.status === 'down').length
              } down`
        }
      />
      <MonitorList
        initialMonitors={monitors}
        metricsByMonitor={Object.fromEntries(recentMetrics)}
      />
    </div>
  );
}
