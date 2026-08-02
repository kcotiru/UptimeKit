import { cookies } from 'next/headers';
import { fetchApi } from '@/lib/api-client';
import { Monitor } from '@/lib/types';
import { Header } from '@/components/layout/header';
import { MonitorList } from '@/components/monitors/monitor-list';

async function getMonitors(token: string): Promise<Monitor[]> {
  try {
    const res = await fetchApi<{ success: boolean; data: Monitor[] }>('/api/v1/monitors', {
      token,
      next: { revalidate: 10 },
    });
    return res.data || [];
  } catch (error: unknown) {
    console.error('Failed to fetch monitors list on server:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * React Server Component for the primary dashboard monitors list page.
 */
export default async function MonitorsPage() {
  const cookieStore = cookies();
  const token = cookieStore.get('uptimekit_token')?.value || '';
  const monitors = await getMonitors(token);

  return (
    <div className="space-y-6">
      <Header
        title="Monitors & Endpoints"
        subtitle={`Active HTTP target checks (${monitors.length} configured)`}
      />
      <MonitorList initialMonitors={monitors} />
    </div>
  );
}
