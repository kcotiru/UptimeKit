'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { PingMetric } from '@/lib/shared/types';
import { CHART_X_MIN_TICK_GAP, CHART_X_TICK_MARGIN, CHART_Y_AXIS_WIDTH, bucketUptime, chartLabel, spansMoreThanADay } from '@/lib/shared/stats';
import { Activity } from 'lucide-react';

/**
 * Props for the UptimeChart component.
 */
export interface UptimeChartProps {
  /** Array of time-series ping performance metric records */
  metrics: PingMetric[];
  /** Height of the chart container in pixels */
  height?: number;
}

/**
 * Recharts time-series graph visualizing per-bucket uptime (%) over time. A
 * dip below 100 is an outage on the raw tier's square wave, or a partial
 * bucket on a rolled-up tier — no second colour marks it, the dip is the
 * signal.
 */
export function UptimeChart({ metrics, height = 320 }: UptimeChartProps) {
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

  // Shared with TimeSeriesChart via lib/shared/stats so the two never drift.
  const spansDays = spansMoreThanADay(metrics);

  const formattedData = metrics.map((m) => ({
    time: chartLabel(m.timestamp, spansDays),
    fullTime: new Date(m.timestamp).toLocaleString(),
    uptime: bucketUptime(m),
    successCount: m.successCount,
    sampleCount: m.sampleCount,
  }));

  return (
    <div className="w-full bg-surface border border-surface-border rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">Uptime</h4>
        </div>
      </div>

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="uptimeGradient" x1="0" y1="0" x2="0" y2="1">
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
              tickMargin={CHART_X_TICK_MARGIN}
              minTickGap={CHART_X_MIN_TICK_GAP}
              axisLine={{ stroke: '#383838' }}
            />
            <YAxis
              width={CHART_Y_AXIS_WIDTH}
              domain={[0, 100]}
              stroke="#a1a1a1"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `${val}%`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-surface/95 border border-surface-border backdrop-blur-md p-3 rounded-lg text-xs space-y-2 font-sans">
                      <p className="text-slate-400 text-[11px]">{data.fullTime}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-medium">uptime</span>
                        <span className="text-brand-400 font-bold">
                          {data.uptime === null ? '—' : `${data.uptime.toFixed(2)}%`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300">checks</span>
                        <span className="text-slate-100">
                          {data.successCount} of {data.sampleCount} succeeded
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="uptime"
              stroke="#4f46e5"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#uptimeGradient)"
              activeDot={{ r: 4, fill: '#4f46e5', stroke: '#a5b4fc', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
