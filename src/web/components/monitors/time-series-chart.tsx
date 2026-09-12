'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { PingMetric } from '@/lib/shared/types';
import { outageRanges } from '@/lib/shared/stats';
import { Activity } from 'lucide-react';

/**
 * Props for the TimeSeriesChart component.
 */
export interface TimeSeriesChartProps {
  /** Array of time-series ping performance metric records */
  metrics: PingMetric[];
  /** Height of the chart container in pixels */
  height?: number;
}

/**
 * Recharts time-series performance graph visualizing response latency (ms) over time.
 */
export function TimeSeriesChart({ metrics, height = 320 }: TimeSeriesChartProps) {
  if (!metrics || metrics.length === 0) {
    return (
      <div
        style={{ height }}
        className="w-full bg-surface/50 border border-surface-border border-dashed rounded-lg flex flex-col items-center justify-center p-8 text-center"
      >
        <div className="h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 mb-3">
          <Activity className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-300">No checks in this window</p>
        <p className="text-xs text-slate-500 max-w-xs mt-1">
          Nothing was recorded between those two times. Try a wider range.
        </p>
      </div>
    );
  }

  // Recharts anchors a ReferenceArea on a category axis by matching the
  // category value. A bare HH:MM repeats every day, so on a window spanning
  // more than 24h (the hourly and daily tiers) two different points could
  // share a label and shade the wrong region. Include the date whenever that
  // can happen.
  const spansDays =
    metrics.length > 1 &&
    new Date(metrics[metrics.length - 1].timestamp).getTime() -
      new Date(metrics[0].timestamp).getTime() >
      24 * 3600 * 1000;

  const label = (iso: string) => {
    const d = new Date(iso);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return spansDays
      ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
      : time;
  };

  const formattedData = metrics.map((m) => ({
    time: label(m.timestamp),
    fullTime: new Date(m.timestamp).toLocaleString(),
    latency: m.responseTimeMs,
    // Recharts draws a band from a [low, high] tuple on one dataKey.
    band: m.minMs !== null && m.maxMs !== null ? [m.minMs, m.maxMs] : null,
    p95: m.p95Ms,
    isUp: m.isUp,
    statusCode: m.statusCode,
  }));

  // Contiguous runs of down samples, so an outage is visible on the time axis
  // instead of the area silently continuing through it.
  const outages = outageRanges(formattedData);

  return (
    <div className="w-full bg-surface border border-surface-border rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">Response time</h4>
        </div>
      </div>

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2665fd" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#2665fd" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3a5c" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#8f9bbd"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#2a3a5c' }}
            />
            <YAxis
              stroke="#8f9bbd"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `${val}ms`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-surface/95 border border-surface-border backdrop-blur-md p-3 rounded-lg text-xs space-y-1.5 font-sans">
                      <p className="text-slate-400 font-mono text-[11px]">{data.fullTime}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-medium">latency</span>
                        <span className="text-brand-400 font-bold font-mono">{data.latency} ms</span>
                      </div>
                      {data.p95 !== null && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-300">p95</span>
                          <span className="text-brand-400 font-medium">{data.p95} ms</span>
                        </div>
                      )}
                      {data.band && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-300">range</span>
                          <span className="text-slate-100">
                            {data.band[0]}–{data.band[1]} ms
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-medium">status</span>
                        <span className={`font-semibold ${data.isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                          {data.isUp ? `HTTP ${data.statusCode || 200}` : 'no response'}
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            {outages.map((outage, i) => (
              <ReferenceArea
                key={i}
                x1={outage.from}
                x2={outage.to}
                fill="#ffb4ab"
                fillOpacity={0.12}
                strokeOpacity={0}
              />
            ))}
            <Area
              type="monotone"
              dataKey="band"
              stroke="none"
              fill="#2665fd"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="latency"
              stroke="#2665fd"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#latencyGradient)"
              activeDot={{ r: 4, fill: '#2665fd', stroke: '#7ca3fe', strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="p95"
              stroke="#7ca3fe"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
