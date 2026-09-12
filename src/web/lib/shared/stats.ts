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

const TIER_RANK: Record<string, number> = { raw: 0, hourly: 1, daily: 2 };

/**
 * The coarsest tier among a window's points: if any point came from daily
 * buckets, the whole window is only as trustworthy as daily buckets, and the
 * UI should say so — not whichever tier happens to be on metrics[0]. Rows
 * are not guaranteed to arrive ordered by tier, so this must reduce over all
 * of them rather than read the first. Returns 'raw' for an empty array.
 */
export function coarsestTier(metrics: { sourceTier: Tier }[]): Tier {
  return metrics.reduce<Tier>(
    (worst, m) => (TIER_RANK[m.sourceTier] > TIER_RANK[worst] ? m.sourceTier : worst),
    'raw'
  );
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

/**
 * Uptime for a single bucket, 0..100, or null when the bucket stands for no
 * samples at all. On the raw tier a point is one sample, so this is 100 or 0
 * and the series reads as a square wave — which is the honest shape of an
 * outage, not a defect to smooth.
 */
export function bucketUptime(metric: PingMetric): number | null {
  const total = metric.sampleCount || 0;
  if (total <= 0) return null;
  return (metric.successCount / total) * 100;
}

/**
 * X-axis label for a chart point. Recharts anchors a ReferenceArea on a
 * category axis by matching the category value; a bare HH:MM repeats every
 * day, so on a window spanning more than 24h (the hourly and daily tiers)
 * two different points could share a label and shade/tooltip the wrong one.
 * Shared by every chart keyed on `metrics` so the two never drift apart.
 */
export function chartLabel(iso: string, spansDays: boolean): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return spansDays
    ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
    : time;
}

/** Whether a window of ordered metrics spans more than 24 hours — the
 *  threshold at which {@link chartLabel} must qualify a label with the date. */
export function spansMoreThanADay(metrics: PingMetric[]): boolean {
  return (
    metrics.length > 1 &&
    new Date(metrics[metrics.length - 1].timestamp).getTime() -
      new Date(metrics[0].timestamp).getTime() >
      24 * 3600 * 1000
  );
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
