import { listMonitors } from '@/lib/monitors';
import { Header } from '@/components/layout/header';
import { MonitorList } from '@/components/monitors/monitor-list';

// Per-user data behind a session cookie — never prerender.
export const dynamic = 'force-dynamic';

/**
 * React Server Component for the primary dashboard monitors list page.
 */
export default async function MonitorsPage() {
  let monitors: Awaited<ReturnType<typeof listMonitors>> = [];

  try {
    monitors = await listMonitors();
  } catch (error: unknown) {
    console.error('Failed to fetch monitors list:', error instanceof Error ? error.message : error);
  }

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
