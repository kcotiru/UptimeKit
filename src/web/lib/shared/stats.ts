import type { PingMetric, Tier } from './types';

/** Window-level figures, with nulls wherever the tier cannot support a claim. */
export interface WindowStats {
  /** Arithmetic mean of every point. Always available. */
  meanMs: number;
  /** Exact percentiles. Raw tier only — null everywhere else. */
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Highest per-bucket p95. Hourly only, where each bucket's p95 was computed
   *  by PERCENTILE_CONT over that hour's real samples. Null on daily, whose
   *  provenance flag never reaches the client. */
  peakP95Ms: number | null;
  /** Share of points reporting up, 0..1. */
  uptime: number;
  /** How many raw samples the window represents. */
  sampleCount: number;
  tier: Tier;
}

/**
 * Linear-interpolating percentile, matching Postgres PERCENTILE_CONT so a
 * figure computed here agrees with one computed in SQL.
 * @param sorted values in ascending order
 * @param p quantile in 0..1
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of an empty list');
  if (sorted.length === 1) return sorted[0];

  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Reduces a window to the figures its tier can honestly support.
 *
 * Rolled-up tiers carry pre-aggregated buckets, and a window percentile cannot
 * be recovered from bucket summaries — so p50/p95/p99 are null there rather
 * than approximated. Returns null for an empty window.
 */
export function summarize(metrics: PingMetric[], tier: Tier): WindowStats | null {
  if (metrics.length === 0) return null;

  const exact = tier === 'raw';
  const latencies = metrics.map((m) => m.responseTimeMs).sort((a, b) => a - b);
  const mean = latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length;
  const bucketP95s = metrics
    .map((m) => m.p95Ms)
    .filter((ms): ms is number => ms !== null);

  return {
    meanMs: Math.round(mean),
    p50Ms: exact ? Math.round(percentile(latencies, 0.5)) : null,
    p95Ms: exact ? Math.round(percentile(latencies, 0.95)) : null,
    p99Ms: exact ? Math.round(percentile(latencies, 0.99)) : null,
    peakP95Ms: tier === 'hourly' && bucketP95s.length > 0 ? Math.max(...bucketP95s) : null,
    uptime: metrics.filter((m) => m.isUp).length / metrics.length,
    sampleCount: metrics.reduce((sum, m) => sum + (m.sampleCount || 1), 0),
    tier,
  };
}
