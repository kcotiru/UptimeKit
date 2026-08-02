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
import { PingMetric } from '@/lib/types';
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
        className="w-full bg-surface/50 border border-surface-border border-dashed rounded-2xl flex flex-col items-center justify-center p-8 text-center"
      >
        <div className="h-10 w-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 mb-3">
          <Activity className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-300">Insufficient Performance Data</p>
        <p className="text-xs text-slate-500 max-w-xs mt-1">
          No ping metrics collected within the selected time window.
        </p>
      </div>
    );
  }

  const formattedData = metrics.map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fullTime: new Date(m.timestamp).toLocaleString(),
    latency: m.responseTimeMs,
    isUp: m.isUp,
    statusCode: m.statusCode,
  }));

  return (
    <div className="w-full bg-surface border border-surface-border rounded-2xl p-6 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-200">Response Latency (ms)</h4>
          <p className="text-xs text-slate-400">Ping duration metrics sampled across selected timeframe</p>
        </div>
      </div>

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#6B7280"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#374151' }}
            />
            <YAxis
              stroke="#6B7280"
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
                    <div className="bg-surface/95 border border-surface-border backdrop-blur-md p-3 rounded-xl shadow-2xl text-xs space-y-1.5 font-sans">
                      <p className="text-slate-400 font-mono text-[11px]">{data.fullTime}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-medium">Latency:</span>
                        <span className="text-brand-400 font-bold font-mono">{data.latency} ms</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-medium">Status:</span>
                        <span className={`font-semibold ${data.isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                          {data.isUp ? `HTTP ${data.statusCode || 200}` : 'Connection Failed'}
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
              dataKey="latency"
              stroke="#3b82f6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#latencyGradient)"
              activeDot={{ r: 5, fill: '#3b82f6', stroke: '#1d4ed8', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
