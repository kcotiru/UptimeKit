import type { WindowStats } from '@/lib/shared/stats';

/** One figure and what it is. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-100">{value}</span>
    </div>
  );
}

/**
 * The window's figures, showing only what its tier can support. On rolled-up
 * tiers `summarize` returns null percentiles, so those stats simply do not
 * render rather than displaying an approximation as though it were exact.
 */
export function StatRow({ stats }: { stats: WindowStats }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <Stat label="uptime" value={`${(stats.uptime * 100).toFixed(2)}%`} />
      <Stat label="mean" value={`${stats.meanMs}ms`} />
      {stats.p50Ms !== null && <Stat label="p50" value={`${stats.p50Ms}ms`} />}
      {stats.p95Ms !== null && <Stat label="p95" value={`${stats.p95Ms}ms`} />}
      {stats.p99Ms !== null && <Stat label="p99" value={`${stats.p99Ms}ms`} />}
      {stats.peakP95Ms !== null && <Stat label="peak hourly p95" value={`${stats.peakP95Ms}ms`} />}
      <Stat label="samples" value={stats.sampleCount.toLocaleString()} />
    </div>
  );
}
