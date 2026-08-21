import Link from 'next/link';
import { ExternalLink, Clock, Trash2, ChevronRight } from 'lucide-react';
import { Monitor } from '@/lib/shared/types';
import { StatusBadge } from './status-badge';
import { formatDate } from '@/lib/shared/utils';

/**
 * Props for the MonitorCard component.
 */
export interface MonitorCardProps {
  /** Monitor target entity data */
  monitor: Monitor;
  /** Callback triggered when user requests deleting the monitor */
  onDeleteRequest: (monitor: Monitor) => void;
}

/**
 * MonitorCard UI component displaying health status, endpoint URL, interval timing, and action links.
 */
export function MonitorCard({ monitor, onDeleteRequest }: MonitorCardProps) {
  return (
    <div className="group relative bg-surface border border-surface-border hover:border-brand-500/50 rounded-xl p-5 transition-all duration-200 shadow-lg hover:shadow-brand-500/5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-slate-100 text-base truncate group-hover:text-brand-400 transition-colors">
              {monitor.name}
            </h3>
            <StatusBadge status={monitor.status} />
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors font-mono truncate max-w-full"
          >
            <span className="truncate">{monitor.url}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </div>

        <button
          onClick={() => onDeleteRequest(monitor)}
          className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition-colors"
          title="Delete monitor"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-surface-border/50 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 font-mono">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            Every {monitor.intervalSeconds}s
          </span>
          <span className="hidden sm:inline-block text-slate-600">•</span>
          <span className="hidden sm:inline-block">
            Last check: <span className="font-mono text-slate-300">{formatDate(monitor.lastCheckedAt)}</span>
          </span>
        </div>

        <Link
          href={`/dashboard/monitors/${monitor.id}`}
          className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 font-medium group-hover:translate-x-0.5 transition-all"
        >
          Metrics <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
