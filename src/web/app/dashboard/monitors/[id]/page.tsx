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
  const now = new Date();
  const from = searchParams.from || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const to = searchParams.to || now.toISOString();

  // Issued together, not one after the other: getMetrics needs only the id and
  // the window, never the monitor row, so awaiting the row first just spends a
  // whole Supabase round trip (~70-150ms) doing nothing. Costs one wasted RPC
  // on the 404 path, which is rare and returns no rows under RLS anyway.
  const [monitor, initialMetrics] = await Promise.all([
    getMonitor(supabaseServer(), params.id).catch((error: unknown) => {
      console.error(`Failed to fetch monitor ${params.id}:`, error instanceof Error ? error.message : error);
      return null;
    }),
    getMetrics(supabaseServer(), params.id, from, to).catch((error: unknown) => {
      console.error(`Failed to fetch metrics for monitor ${params.id}:`, error instanceof Error ? error.message : error);
      return [] as PingMetric[];
    }),
  ]);

  if (!monitor) {
    notFound();
  }

  // Same reason as the monitors list: MonitorDetailView is a client component,
  // so a clock it reads itself would differ between the server HTML and the
  // hydration pass.
  return (
    <MonitorDetailView monitor={monitor} initialMetrics={initialMetrics} renderedAt={Date.now()} />
  );
}
