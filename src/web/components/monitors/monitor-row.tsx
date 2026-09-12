import Link from 'next/link';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Monitor, PingMetric } from '@/lib/shared/types';
import { StatusWord } from './status-badge';
import { Sparkline } from './sparkline';
import { cn, formatRelative, downSinceLabel, RECENT_WINDOW_HOURS } from '@/lib/shared/utils';
import { downsample } from '@/lib/shared/sparkline';
import { summarize } from '@/lib/shared/stats';

export interface MonitorRowProps {
  monitor: Monitor;
  metrics: PingMetric[];
  onDeleteRequest: (monitor: Monitor) => void;
}

/**
 * One monitor as a full-width row.
 *
 * Denser than a card grid, and it gives the list somewhere to put rank: a
 * monitor that is not up carries an error-toned border, the one case where the
 * whole row is the alarm.
 */
export function MonitorRow({ monitor, metrics, onDeleteRequest }: MonitorRowProps) {
  const needsAttention = monitor.status !== 'up';
  const stats = summarize(metrics, 'raw');

  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  // metrics are ascending by timestamp; walk back from the end for the most
  // recent point that was actually up.
  const lastUp = needsAttention ? [...metrics].reverse().find((m) => m.isUp) ?? null : null;

  const downLabel = downSinceLabel(monitor.createdAt, lastUp?.timestamp ?? null, RECENT_WINDOW_HOURS);

  return (
    <div
      className={cn(
        'group bg-surface border rounded-lg p-4 transition-colors',
        needsAttention ? 'border-status-down/50' : 'border-surface-border hover:border-brand-500/40'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/monitors/${monitor.id}`}
              className="text-base font-semibold text-slate-100 hover:text-brand-400 transition-colors truncate"
            >
              {monitor.name}
            </Link>
            <StatusWord status={monitor.status} />
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer"
            title={monitor.url}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 transition-colors truncate max-w-full"
          >
            <span className="truncate">{monitor.url}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            {metrics.length > 0 && (
              <span className={needsAttention ? 'text-status-down' : 'text-brand-400'}>
                <Sparkline values={downsample(metrics, 48).map((m) => m.responseTimeMs)} />
              </span>
            )}

            {stats && (
              <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>{`uptime ${(stats.uptime * 100).toFixed(1)}%`}</span>
                {stats.p50Ms !== null && <span>{`p50 ${stats.p50Ms}ms`}</span>}
                {stats.p95Ms !== null && <span>{`p95 ${stats.p95Ms}ms`}</span>}
                <span>{`${RECENT_WINDOW_HOURS}h`}</span>
              </span>
            )}

            {needsAttention && latest?.statusCode !== null && latest?.statusCode !== undefined && (
              <span className="text-xs text-status-down">{`HTTP ${latest.statusCode}`}</span>
            )}

            {needsAttention && <span className="text-xs text-status-down">{downLabel}</span>}
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden sm:inline text-xs text-slate-400">
            checked {formatRelative(monitor.lastCheckedAt)}
          </span>
          <button
            onClick={() => onDeleteRequest(monitor)}
            className="text-slate-400 hover:text-status-down p-2 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label={`Delete ${monitor.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
