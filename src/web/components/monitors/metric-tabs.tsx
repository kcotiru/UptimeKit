'use client';

import { useState } from 'react';
import { PingMetric } from '@/lib/shared/types';
import { TimeSeriesChart } from './time-series-chart';
import { UptimeChart } from './uptime-chart';

type MetricTab = 'response-time' | 'uptime';

const TABS: { id: MetricTab; label: string }[] = [
  { id: 'response-time', label: 'Response time' },
  { id: 'uptime', label: 'Uptime' },
];

/**
 * Segmented control switching between the latency and uptime charts. Both
 * read the same `metrics` array, so switching tabs never refetches anything.
 * Selection is local UI state — it does not go in the URL.
 */
export function MetricTabs({ metrics }: { metrics: PingMetric[] }) {
  const [tab, setTab] = useState<MetricTab>('response-time');

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1 rounded-lg border border-surface-border p-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === id ? 'bg-surface-hover text-slate-100' : 'text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'response-time' ? (
        <TimeSeriesChart metrics={metrics} />
      ) : (
        <UptimeChart metrics={metrics} />
      )}
    </div>
  );
}
