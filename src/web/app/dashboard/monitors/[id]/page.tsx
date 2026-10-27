import { notFound } from 'next/navigation';
import { getMetrics, getMonitor } from '@/lib/server/data/monitors';
import { PingMetric, TimeRangePreset } from '@/lib/shared/types';
import { MonitorDetailView } from '@/components/monitors/monitor-detail-view';
import { getSessionUser, supabaseServer } from '@/lib/server/supabase';
import { MANAGE_ROLES, can } from '@/lib/server/actions/require-role';
import { metricsWindow, uuidArg } from '@/lib/shared/validations/action-args';

// Per-user data behind a session cookie: never prerender.
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
  searchParams: { from?: string; to?: string; preset?: string };
}) {
  if (!uuidArg.safeParse(params.id).success) notFound();

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const defaultTo = now.toISOString();
  // Same cap the server action enforces. A bad or stale link falls back to the
  // default window silently: it is only a URL, so rendering beats an error page.
  const requested = metricsWindow.safeParse({
    id: params.id,
    from: searchParams.from ?? defaultFrom,
    to: searchParams.to ?? defaultTo,
  });
  const { from, to } = requested.success ? requested.data : { from: defaultFrom, to: defaultTo };
  // The label must describe the window fetched above. No bounds, or rejected
  // ones, got the 24h default. Our own URL sync always writes preset, from and
  // to together, so only a URL with both bounds can carry a trusted preset name;
  // a lone bound came from elsewhere and is an explicit, custom window.
  const pinned = requested.success && (searchParams.from || searchParams.to);
  const named =
    !!searchParams.from && !!searchParams.to && ['1h', '24h', '7d', '30d'].includes(searchParams.preset ?? '');
  const preset: TimeRangePreset = pinned ? (named ? (searchParams.preset as TimeRangePreset) : 'custom') : '24h';

  // Issued together, not one after the other: getMetrics needs only the id and
  // the window, never the monitor row, so awaiting the row first just spends a
  // whole Supabase round trip (~70-150ms) doing nothing. Costs one wasted RPC
  // on the 404 path, which is rare and returns no rows under RLS anyway.
  const [monitor, initialMetrics, user] = await Promise.all([
    getMonitor(supabaseServer(), params.id).catch((error: unknown) => {
      console.error(`Failed to fetch monitor ${params.id}:`, error instanceof Error ? error.message : error);
      return null;
    }),
    getMetrics(supabaseServer(), params.id, from, to).catch((error: unknown) => {
      console.error(`Failed to fetch metrics for monitor ${params.id}:`, error instanceof Error ? error.message : error);
      return [] as PingMetric[];
    }),
    getSessionUser().catch(() => null),
  ]);

  if (!monitor) {
    notFound();
  }

  // Same reason as the monitors list: MonitorDetailView is a client component,
  // so a clock it reads itself would differ between the server HTML and the
  // hydration pass.
  return (
    <MonitorDetailView
      monitor={monitor}
      initialMetrics={initialMetrics}
      from={from}
      to={to}
      preset={preset}
      renderedAt={Date.now()}
      canManage={can(user, MANAGE_ROLES)}
    />
  );
}
