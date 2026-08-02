import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { fetchApi } from '@/lib/api-client';
import { Monitor, PingMetric } from '@/lib/types';
import { MonitorDetailView } from '@/components/monitors/monitor-detail-view';

async function getMonitorDetail(id: string, token: string): Promise<Monitor | null> {
  try {
    const res = await fetchApi<{ success: boolean; data: Monitor }>(`/api/v1/monitors/${id}`, {
      token,
    });
    return res.data || null;
  } catch (error: unknown) {
    console.error(`Failed to fetch monitor ${id}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function getInitialMetrics(
  id: string,
  token: string,
  fromISO: string,
  toISO: string
): Promise<PingMetric[]> {
  try {
    const res = await fetchApi<{ success: boolean; data: { metrics: PingMetric[] } }>(
      `/api/v1/monitors/${id}/metrics?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
      { token }
    );
    return res.data?.metrics || [];
  } catch (error: unknown) {
    console.error(`Failed to fetch metrics for monitor ${id}:`, error instanceof Error ? error.message : error);
    return [];
  }
}

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
  const cookieStore = cookies();
  const token = cookieStore.get('uptimekit_token')?.value || '';

  const monitor = await getMonitorDetail(params.id, token);

  if (!monitor) {
    notFound();
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  
  const from = searchParams.from || defaultFrom;
  const to = searchParams.to || now.toISOString();

  const initialMetrics = await getInitialMetrics(params.id, token, from, to);

  return <MonitorDetailView monitor={monitor} initialMetrics={initialMetrics} />;
}
