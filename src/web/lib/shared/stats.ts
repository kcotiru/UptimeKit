import type { PingMetric, Tier } from './types';

/** Window-level figures, with nulls wherever the tier cannot support a claim. */
export interface WindowStats {
  /** Arithmetic mean of every point. Always available. */
  meanMs: number;
  /** Exact *window* percentiles. Raw tier only — a single window percentile
   *  cannot be recovered from pre-aggregated buckets, so these stay null on
   *  hourly and daily. */
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Highest per-bucket p50/p95/p99 across the window — "the worst bucket's
   *  percentile", not a window percentile. Available on hourly and daily,
   *  where each point already carries its own bucket's percentiles. Null on
   *  raw, where p50Ms/p95Ms/p99Ms above are already exact and stronger. */
  peakP50Ms: number | null;
  peakP95Ms: number | null;
  peakP99Ms: number | null;
  /** Exact on every tier: sum(successCount) / sum(sampleCount). Rolled-up
   *  buckets carry a real success count now, so this is never a synthesised
   *  100%. */
  uptime: number;
  /** How many raw samples the window represents. */
  sampleCount: number;
  /** How many buckets in this window are 'hourly_approx' (percentiles of
   *  percentiles) rather than 'raw'. Always 0 on the raw tier. */
  approxBuckets: number;
  /** Total buckets (points) in the window — the denominator for approxBuckets. */
  bucketCount: number;
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

/** Max of the non-null values, or null if none. */
function peakOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

/**
 * Reduces a window to the figures its tier can honestly support.
 *
 * Rolled-up tiers carry pre-aggregated buckets, and a single *window*
 * percentile cannot be recovered from them — so exact p50/p95/p99 stay null
 * there. What the buckets do support truthfully is a peak: the worst bucket's
 * own percentile, reported separately so the UI can say "the worst hour's p95
 * was 402ms" without implying it is a window-wide figure. Returns null for an
 * empty window.
 */
export function summarize(metrics: PingMetric[], tier: Tier): WindowStats | null {
  if (metrics.length === 0) return null;

  const exact = tier === 'raw';
  const latencies = metrics.map((m) => m.responseTimeMs).sort((a, b) => a - b);
  const mean = latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length;

  const successCount = metrics.reduce((sum, m) => sum + m.successCount, 0);
  const sampleCount = metrics.reduce((sum, m) => sum + (m.sampleCount || 1), 0);
  const approxBuckets = metrics.filter((m) => m.percentileSource === 'hourly_approx').length;

  return {
    meanMs: Math.round(mean),
    // ping_logs_raw.response_time_ms is NOT NULL, so a failed ping still
    // contributes its elapsed time to this pool: raw percentiles describe
    // every attempt, not just successful responses. Failures are not
    // filtered out here — that would change what the number means without
    // saying so.
    p50Ms: exact ? Math.round(percentile(latencies, 0.5)) : null,
    p95Ms: exact ? Math.round(percentile(latencies, 0.95)) : null,
    p99Ms: exact ? Math.round(percentile(latencies, 0.99)) : null,
    peakP50Ms: exact ? null : peakOf(metrics.map((m) => m.p50Ms)),
    peakP95Ms: exact ? null : peakOf(metrics.map((m) => m.p95Ms)),
    peakP99Ms: exact ? null : peakOf(metrics.map((m) => m.p99Ms)),
    uptime: successCount / sampleCount,
    sampleCount,
    approxBuckets,
    bucketCount: metrics.length,
    tier,
  };
}

/** One contiguous down run, identified by the x-axis label of its first and
 *  last point (inclusive) — what a chart's ReferenceArea anchors on. */
export interface OutageRange {
  from: string;
  to: string;
}

/** A chart point reduced to what outage detection needs: a unique x-axis
 *  label and whether the sample was up. */
export interface OutagePoint {
  time: string;
  isUp: boolean;
}

/**
 * Contiguous runs of `isUp === false`, so an outage can be shaded on a chart
 * instead of the trace silently continuing through it. `time` must be unique
 * per point — recharts matches a ReferenceArea to a category axis by value,
 * so a repeating label (e.g. bare HH:MM across days) would shade the wrong
 * region.
 */
export function outageRanges(points: OutagePoint[]): OutageRange[] {
  const ranges: OutageRange[] = [];
  let i = 0;
  while (i < points.length) {
    if (points[i].isUp) {
      i++;
      continue;
    }
    const start = i;
    while (i + 1 < points.length && !points[i + 1].isUp) i++;
    ranges.push({ from: points[start].time, to: points[i].time });
    i++;
  }
  return ranges;
}
