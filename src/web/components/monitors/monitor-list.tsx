'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Activity, Search } from 'lucide-react';
import { Monitor, PingMetric } from '@/lib/shared/types';
import { byUrgency } from '@/lib/shared/utils';
import { MonitorRow } from './monitor-row';
import { DeleteMonitorModal } from './delete-monitor-modal';
import { deleteMonitorAction } from '@/lib/server/actions/monitors';

/**
 * Props for the MonitorList component.
 */
export interface MonitorListProps {
  /** Initial array of monitors pre-fetched on the server via RSC */
  initialMonitors: Monitor[];
  /** Recent raw samples per monitor id, for the sparkline and stats on each row */
  metricsByMonitor: Record<string, PingMetric[]>;
}

/**
 * Client Component for searching, displaying, and managing the team's HTTP monitors list.
 */
export function MonitorList({ initialMonitors, metricsByMonitor }: MonitorListProps) {
  const [monitors, setMonitors] = useState<Monitor[]>(initialMonitors);
  const [search, setSearch] = useState('');
  const [deletingMonitor, setDeletingMonitor] = useState<Monitor | null>(null);

  const filteredMonitors = monitors
    .filter(
      (m) =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.url.toLowerCase().includes(search.toLowerCase())
    )
    .sort(byUrgency);

  const handleDelete = async (id: string) => {
    try {
      const outcome = await deleteMonitorAction(id);

      if (!outcome.ok) {
        throw new Error(outcome.error);
      }

      setMonitors((prev) => prev.filter((m) => m.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not delete that monitor.';
      alert(msg);
      throw err;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name or URL"
            className="w-full pl-10 pr-4 py-2 bg-surface border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 transition-all"
          />
        </div>

        <Link
          href="/dashboard/monitors/new"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm rounded-lg transition-all shrink-0"
        >
          <Plus className="h-4 w-4" /> Add monitor
        </Link>
      </div>

      {/* Monitor List */}
      {filteredMonitors.length === 0 ? (
        <div className="bg-surface border border-surface-border border-dashed rounded-lg p-8 text-center space-y-4">
          <div className="h-12 w-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
            <Activity className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-200">No monitors yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {search
                ? 'Nothing matches that filter.'
                : 'Add an endpoint and UptimeKit will check it on a schedule and tell you when it breaks.'}
            </p>
          </div>
          {!search && (
            <Link
              href="/dashboard/monitors/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-all"
            >
              <Plus className="h-4 w-4" /> Add your first monitor
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMonitors.map((monitor) => (
            <MonitorRow
              key={monitor.id}
              monitor={monitor}
              metrics={metricsByMonitor[monitor.id] ?? []}
              onDeleteRequest={setDeletingMonitor}
            />
          ))}
        </div>
      )}

      <DeleteMonitorModal
        monitor={deletingMonitor}
        onClose={() => setDeletingMonitor(null)}
        onConfirmDelete={handleDelete}
      />
    </div>
  );
}
