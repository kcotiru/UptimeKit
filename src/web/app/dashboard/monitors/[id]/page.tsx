import { notFound } from 'next/navigation';
import { getMetrics, getMonitor } from '@/lib/server/data/monitors';
import { PingMetric } from '@/lib/shared/types';
import { MonitorDetailView } from '@/components/monitors/monitor-detail-view';
import { supabaseServer } from '@/lib/server/supabase';

// Per-user data behind a session cookie — never prerender.
export const dynamic = 'force-dynamic';

/**
 * React Server Component for the monitor detail & time-series graph page.
 * Accepts searchParams for deep-linked time window initialization (SC-004).
 */
export default async function MonitorDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}) {
  const monitor = await getMonitor(supabaseServer(), params.id).catch((error: unknown) => {
    console.error(`Failed to fetch monitor ${params.id}:`, error instanceof Error ? error.message : error);
    return null;
  });

  if (!monitor) {
    notFound();
  }

  const now = new Date();
  const from = searchParams.from || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const to = searchParams.to || now.toISOString();

  let initialMetrics: PingMetric[] = [];
  try {
    initialMetrics = await getMetrics(supabaseServer(), params.id, from, to);
  } catch (error: unknown) {
    console.error(`Failed to fetch metrics for monitor ${params.id}:`, error instanceof Error ? error.message : error);
  }

  return <MonitorDetailView monitor={monitor} initialMetrics={initialMetrics} />;
}
