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
import { CHART_Y_AXIS_WIDTH, chartLabel, outageRanges, spansMoreThanADay } from '@/lib/shared/stats';
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
 * What the tooltip can honestly say about a point's outcome. `statusCode` is
 * null for every rolled-up bucket and every point on the public share page —
 * printing "HTTP 200" there would be a guess, not a fact. Falls back to the
 * success ratio the bucket actually carries, and says nothing at all for the
 * single-sample rolled-up case rather than dressing up one data point as a
 * status code.
 */
function statusLabel(data: {
  statusCode: number | null;
  isUp: boolean;
  successCount: number;
  sampleCount: number;
}): string | null {
  if (data.statusCode !== null) return `HTTP ${data.statusCode}`;
  if (!data.isUp) return 'no response';
  if (data.sampleCount === 1) return null;
  return `${data.successCount} of ${data.sampleCount} checks succeeded`;
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
  // can happen. Shared with UptimeChart via lib/shared/stats so the two never
  // drift apart.
  const spansDays = spansMoreThanADay(metrics);

  const formattedData = metrics.map((m) => ({
    time: chartLabel(m.timestamp, spansDays),
    fullTime: new Date(m.timestamp).toLocaleString(),
    latency: m.responseTimeMs,
    // Recharts draws a band from a [low, high] tuple on one dataKey.
    band: m.minMs !== null && m.maxMs !== null ? [m.minMs, m.maxMs] : null,
    p95: m.p95Ms,
    isUp: m.isUp,
    statusCode: m.statusCode,
    successCount: m.successCount,
    sampleCount: m.sampleCount,
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
          <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#383838" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#a1a1a1"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#383838' }}
            />
            <YAxis
              width={CHART_Y_AXIS_WIDTH}
              stroke="#a1a1a1"
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
                    <div className="bg-surface/95 border border-surface-border backdrop-blur-md p-3 rounded-lg text-xs space-y-2 font-sans">
                      <p className="text-slate-400 text-[11px]">{data.fullTime}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-medium">latency</span>
                        <span className="text-brand-400 font-bold">{data.latency} ms</span>
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
                      {statusLabel(data) && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-300 font-medium">status</span>
                          <span className={`font-semibold ${data.isUp ? 'text-brand-400' : 'text-red-400'}`}>
                            {statusLabel(data)}
                          </span>
                        </div>
                      )}
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
                fill="#ff6166"
                fillOpacity={0.12}
                strokeOpacity={0}
              />
            ))}
            <Area
              type="monotone"
              dataKey="band"
              stroke="none"
              fill="#4f46e5"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="latency"
              stroke="#4f46e5"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#latencyGradient)"
              activeDot={{ r: 4, fill: '#4f46e5', stroke: '#a5b4fc', strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="p95"
              stroke="#a5b4fc"
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
