'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Activity, Search } from 'lucide-react';
import { Monitor } from '@/lib/shared/types';
import { MonitorCard } from './monitor-card';
import { DeleteMonitorModal } from './delete-monitor-modal';
import { deleteMonitorAction } from '@/lib/server/actions/monitors';

/**
 * Props for the MonitorList component.
 */
export interface MonitorListProps {
  /** Initial array of monitors pre-fetched on the server via RSC */
  initialMonitors: Monitor[];
}

/**
 * Client Component for searching, displaying, and managing the team's HTTP monitors grid.
 */
export function MonitorList({ initialMonitors }: MonitorListProps) {
  const [monitors, setMonitors] = useState<Monitor[]>(initialMonitors);
  const [search, setSearch] = useState('');
  const [deletingMonitor, setDeletingMonitor] = useState<Monitor | null>(null);

  const filteredMonitors = monitors.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.url.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    try {
      const outcome = await deleteMonitorAction(id);

      if (!outcome.ok) {
        throw new Error(outcome.error);
      }

      setMonitors((prev) => prev.filter((m) => m.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error deleting monitor';
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
            placeholder="Filter monitors by name or URL..."
            className="w-full pl-10 pr-4 py-2 bg-surface border border-surface-border rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 transition-all"
          />
        </div>

        <Link
          href="/dashboard/monitors/new"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-brand-600/30 transition-all shrink-0"
        >
          <Plus className="h-4 w-4" /> Add Monitor
        </Link>
      </div>

      {/* Monitor Grid */}
      {filteredMonitors.length === 0 ? (
        <div className="bg-surface border border-surface-border border-dashed rounded-2xl p-12 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
            <Activity className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-200">No monitors found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {search
                ? 'No monitoring targets match your search filter.'
                : 'Get started by creating your first HTTP endpoint health check monitor.'}
            </p>
          </div>
          {!search && (
            <Link
              href="/dashboard/monitors/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-lg shadow-md transition-all"
            >
              <Plus className="h-4 w-4" /> Create Monitor Now
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredMonitors.map((monitor) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
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
