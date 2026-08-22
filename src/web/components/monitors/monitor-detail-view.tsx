'use client';

import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import { Monitor, PingMetric } from '@/lib/shared/types';
import { StatusBadge } from './status-badge';
import { TimeRangePicker, TimeRangePreset } from './time-range-picker';
import { TimeSeriesChart } from './time-series-chart';
import { SaveViewButton } from './save-view-button';
import { formatDate, calculateTimestamps } from '@/lib/shared/utils';
import { fetchMetricsAction } from '@/lib/server/actions/monitors';

/**
 * Props for the MonitorDetailView component.
 */
export interface MonitorDetailViewProps {
  /** Target monitor entity metadata */
  monitor: Monitor;
  /** Initial time-series metrics data pre-fetched on the server via RSC */
  initialMetrics: PingMetric[];
}

/**
 * MonitorDetailView component managing Recharts graph state and URL search param synchronization.
 */
export function MonitorDetailView({ monitor, initialMetrics }: MonitorDetailViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPreset = (searchParams.get('preset') as TimeRangePreset) || '24h';
  const [preset, setPreset] = useState<TimeRangePreset>(currentPreset);
  const [metrics, setMetrics] = useState<PingMetric[]>(initialMetrics);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in state so the share button pins the window actually on screen.
  const initialBounds = calculateTimestamps(currentPreset);
  const [window_, setWindow] = useState({
    from: searchParams.get('from') ?? initialBounds.from,
    to: searchParams.get('to') ?? initialBounds.to,
  });

  const handleSelectPreset = (
    newPreset: TimeRangePreset,
    customFrom?: string,
    customTo?: string
  ) => {
    setPreset(newPreset);
    
    let from: string;
    let to: string;

    if (newPreset === 'custom' && customFrom && customTo) {
      from = customFrom;
      to = customTo;
    } else {
      const bounds = calculateTimestamps(newPreset);
      from = bounds.from;
      to = bounds.to;
    }

    setWindow({ from, to });

    // Synchronize URL query parameters for deep-linking (FR-008 & SC-004)
    const params = new URLSearchParams(searchParams.toString());
    params.set('preset', newPreset);
    params.set('from', from);
    params.set('to', to);

    router.replace(`${pathname}?${params.toString()}`);
    fetchMetrics(from, to);
  };

  const fetchMetrics = async (fromISO: string, toISO: string) => {
    setLoading(true);
    setError(null);
    try {
      const outcome = await fetchMetricsAction(monitor.id, fromISO, toISO);
      if (outcome.ok) {
        setMetrics(outcome.data);
      } else {
        setError(outcome.error);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error while fetching metrics';
      setError(msg);
      console.error('Error fetching metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/monitors"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Monitors
        </Link>
        <button
          onClick={() => {
            const bounds = calculateTimestamps(preset);
            fetchMetrics(bounds.from, bounds.to);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border text-slate-300 text-xs font-semibold rounded-lg transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Metrics
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Monitor Header Overview */}
      <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-50 tracking-tight">{monitor.name}</h1>
              <StatusBadge status={monitor.status} />
            </div>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-brand-400 font-mono transition-colors"
            >
              {monitor.url} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="flex items-center gap-6 text-xs text-slate-400 border-t sm:border-t-0 sm:border-l border-surface-border pt-3 sm:pt-0 sm:pl-6">
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider">Interval</p>
              <p className="font-semibold text-slate-200 font-mono flex items-center gap-1 mt-0.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" /> {monitor.intervalSeconds}s
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider">Timeout</p>
              <p className="font-semibold text-slate-200 font-mono mt-0.5">{monitor.timeoutMs}ms</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider">Last Check</p>
              <p className="font-semibold text-slate-200 font-mono mt-0.5">{formatDate(monitor.lastCheckedAt)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Graph Filter & Chart Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-100">Performance History</h3>
          <div className="flex items-center gap-2">
            <SaveViewButton monitorId={monitor.id} from={window_.from} to={window_.to} />
            <TimeRangePicker selectedPreset={preset} onSelectPreset={handleSelectPreset} />
          </div>
        </div>

        <TimeSeriesChart metrics={metrics} />
      </div>
    </div>
  );
}
