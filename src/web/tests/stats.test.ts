import { describe, it, expect } from 'vitest';
import {
  percentile,
  summarize,
  bucketUptime,
  coarsestTier,
  spansMoreThanADay,
  chartLabel,
} from '../lib/shared/stats';
import type { PingMetric } from '../lib/shared/types';

function point(overrides: Partial<PingMetric> = {}): PingMetric {
  return {
    timestamp: '2026-09-12T00:00:00Z',
    responseTimeMs: 100,
    statusCode: 200,
    isUp: true,
    minMs: null,
    maxMs: null,
    p95Ms: null,
    sampleCount: 1,
    sourceTier: 'raw',
    successCount: 1,
    p50Ms: null,
    p99Ms: null,
    percentileSource: 'raw',
    ...overrides,
  };
}

describe('percentile', () => {
  // Linear interpolation, matching Postgres PERCENTILE_CONT, so a percentile
  // computed here and one computed in SQL agree.
  it('interpolates between neighbours the way PERCENTILE_CONT does', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('returns the bounds at 0 and 1', () => {
    expect(percentile([5, 9, 14], 0)).toBe(5);
    expect(percentile([5, 9, 14], 1)).toBe(14);
  });

  it('handles a single sample', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('refuses an empty list rather than returning a misleading zero', () => {
    expect(() => percentile([], 0.5)).toThrow();
  });
});

describe('summarize', () => {
  it('returns null for an empty window', () => {
    expect(summarize([], 'raw')).toBeNull();
  });

  // ping_logs_raw.response_time_ms is NOT NULL, so a failed ping still
  // contributes its elapsed time to the raw percentile pool: these figures
  // describe every attempt, not only successful ones. One hundred samples
  // (2..200 ms) is the smallest window that supports all three quantiles, and
  // every tenth one is a failure. The values differ per field so a transposed
  // field would fail.
  it('computes exact window percentiles on the raw tier, over every attempt including failures', () => {
    const metrics = Array.from({ length: 100 }, (_, i) =>
      point({ responseTimeMs: (i + 1) * 2, isUp: i % 10 !== 9, successCount: i % 10 !== 9 ? 1 : 0 })
    );
    const stats = summarize(metrics, 'raw')!;

    expect(stats.p50Ms).toBe(101);
    expect(stats.p95Ms).toBe(190);
    expect(stats.p99Ms).toBe(198);
    expect(stats.uptime).toBe(0.9);
    expect(stats.tier).toBe('raw');
  });

  // Review Focus 2: boundaries from both sides.
  it('reports p50 at exactly two samples and not at one', () => {
    expect(summarize([point({ responseTimeMs: 100 })], 'raw')!.p50Ms).toBeNull();
    const two = [100, 200].map((ms) => point({ responseTimeMs: ms }));
    expect(summarize(two, 'raw')!.p50Ms).toBe(150);
  });

  it('reports p95 at exactly twenty samples and not at nineteen', () => {
    const at = Array.from({ length: 20 }, (_, i) => point({ responseTimeMs: (i + 1) * 10 }));
    expect(summarize(at.slice(0, 19), 'raw')!.p95Ms).toBeNull();
    expect(summarize(at, 'raw')!.p95Ms).toBe(191);
  });

  it('reports p99 at exactly one hundred samples and not at ninety-nine', () => {
    const at = Array.from({ length: 100 }, (_, i) => point({ responseTimeMs: (i + 1) * 10 }));
    expect(summarize(at.slice(0, 99), 'raw')!.p99Ms).toBeNull();
    expect(summarize(at, 'raw')!.p99Ms).toBe(990);
  });

  // The gate counts values actually interpolated, not the samples they stand
  // for: three buckets of 120 pings sum to 360 but give percentile() 3 values.
  it('does not report p99 over three rolled-up buckets passed with a raw tier', () => {
    const buckets = [100, 200, 300].map((ms) => point({ responseTimeMs: ms, sourceTier: 'hourly', sampleCount: 120 }));
    expect(summarize(buckets, 'raw')!.p99Ms).toBeNull();
  });

  it('keeps the mean and the uptime whatever the sample count', () => {
    const stats = summarize([point({ responseTimeMs: 420 })], 'raw')!;
    expect(stats.p50Ms).toBeNull();
    expect(stats.meanMs).toBe(420);
    expect(stats.uptime).toBe(1);
    expect(stats.sampleCount).toBe(1);
  });

  it('skips a thin bucket when taking the peak per-bucket percentile', () => {
    const thin = point({ sourceTier: 'hourly', sampleCount: 1, p50Ms: 9000, p95Ms: 9000, p99Ms: 9000 });
    const full = point({ sourceTier: 'hourly', sampleCount: 120, p50Ms: 100, p95Ms: 300, p99Ms: 400 });
    const stats = summarize([thin, full], 'hourly')!;
    expect(stats.peakP50Ms).toBe(100);
    expect(stats.peakP95Ms).toBe(300);
    expect(stats.peakP99Ms).toBe(400);
  });

  // The thin bucket carries the larger value, so the peak shows which side of the edge each bucket fell on.
  it('counts an hourly bucket of exactly 20 toward peak p95 and skips one of 19', () => {
    const atEdge = point({ sourceTier: 'hourly', sampleCount: 20, p50Ms: null, p95Ms: 500, p99Ms: null });
    const below = point({ sourceTier: 'hourly', sampleCount: 19, p50Ms: null, p95Ms: 900, p99Ms: null });
    expect(summarize([atEdge, below], 'hourly')!.peakP95Ms).toBe(500);
  });

  it('counts an hourly bucket of exactly 100 toward peak p99 and skips one of 99', () => {
    const atEdge = point({ sourceTier: 'hourly', sampleCount: 100, p50Ms: null, p95Ms: null, p99Ms: 600 });
    const below = point({ sourceTier: 'hourly', sampleCount: 99, p50Ms: null, p95Ms: null, p99Ms: 950 });
    expect(summarize([atEdge, below], 'hourly')!.peakP99Ms).toBe(600);
  });

  it('drops peak p99 on a daily bucket whose percentiles came from hourly ones', () => {
    const approx = point({
      sourceTier: 'daily', sampleCount: 5000, percentileSource: 'hourly_approx',
      p50Ms: 100, p95Ms: 300, p99Ms: 400,
    });
    const stats = summarize([approx], 'daily')!;
    expect(stats.peakP50Ms).toBe(100);
    expect(stats.peakP95Ms).toBe(300);
    expect(stats.peakP99Ms).toBeNull();
  });

  // A window p95 cannot be recovered from per-bucket summaries, so the rolled
  // up tiers must not claim one. This is the spec's central honesty rule.
  it('refuses to report exact window percentiles on rolled-up tiers', () => {
    const metrics = [100, 200].map((ms) => point({ responseTimeMs: ms, sourceTier: 'hourly', p50Ms: ms, p95Ms: ms * 2, p99Ms: ms * 3 }));
    const stats = summarize(metrics, 'hourly')!;

    expect(stats.p50Ms).toBeNull();
    expect(stats.p95Ms).toBeNull();
    expect(stats.p99Ms).toBeNull();
  });

  it('reports the peak per-bucket p50/p95/p99 on the hourly tier, ignoring nulls', () => {
    const metrics = [
      point({ sourceTier: 'hourly', sampleCount: 120, p50Ms: 110, p95Ms: 300, p99Ms: 500 }),
      point({ sourceTier: 'hourly', sampleCount: 120, p50Ms: 210, p95Ms: 900, p99Ms: 950 }),
      point({ sourceTier: 'hourly', sampleCount: 120, p50Ms: null, p95Ms: null, p99Ms: null }),
    ];
    const stats = summarize(metrics, 'hourly')!;

    expect(stats.peakP50Ms).toBe(210);
    expect(stats.peakP95Ms).toBe(900);
    expect(stats.peakP99Ms).toBe(950);
  });

  // Daily buckets carry the same per-bucket p50/p95/p99 columns as hourly, so
  // the same "worst bucket" figure holds: it never becomes null just because
  // the tier is coarser. The hourly_approx bucket still counts for p50 and p95
  // (capped at 24 samples) but not p99, so p99 comes from the raw bucket.
  it('reports the peak per-bucket percentiles on the daily tier too', () => {
    const metrics = [
      point({ sourceTier: 'daily', sampleCount: 5000, p50Ms: 140, p95Ms: 380, p99Ms: 600, percentileSource: 'raw' }),
      point({ sourceTier: 'daily', sampleCount: 5000, p50Ms: 260, p95Ms: 920, p99Ms: 970, percentileSource: 'hourly_approx' }),
    ];
    const stats = summarize(metrics, 'daily')!;

    expect(stats.peakP50Ms).toBe(260);
    expect(stats.peakP95Ms).toBe(920);
    expect(stats.peakP99Ms).toBe(600);
  });

  it('measures uptime on the raw tier from successCount/sampleCount', () => {
    const metrics = [
      point({ successCount: 1, sampleCount: 1 }),
      point({ successCount: 1, sampleCount: 1 }),
      point({ successCount: 1, sampleCount: 1 }),
      point({ successCount: 0, sampleCount: 1 }),
    ];
    expect(summarize(metrics, 'raw')!.uptime).toBe(0.75);
  });

  // The old implementation read isUp off buckets, which is always
  // synthesised true, silently reading 100% no matter what actually
  // happened. successCount/sampleCount must disprove that.
  it('measures uptime on a rolled-up tier as sum(successCount)/sum(sampleCount), not a flat 100%', () => {
    const metrics = [
      point({ sourceTier: 'hourly', successCount: 9, sampleCount: 12 }),
      point({ sourceTier: 'hourly', successCount: 8, sampleCount: 11 }),
    ];
    expect(summarize(metrics, 'hourly')!.uptime).toBeCloseTo(17 / 23);
  });

  // A plain per-point average would give the 3-ping bucket the same weight
  // as the 120-ping one, dragging the mean toward the small bucket's value.
  it('weights meanMs by sampleCount, not a flat average of points', () => {
    const metrics = [
      point({ sourceTier: 'hourly', responseTimeMs: 100, sampleCount: 120 }),
      point({ sourceTier: 'hourly', responseTimeMs: 1000, sampleCount: 3 }),
    ];
    const stats = summarize(metrics, 'hourly')!;

    // Unweighted average would be 550; weighted is (100*120 + 1000*3) / 123.
    expect(stats.meanMs).toBe(Math.round((100 * 120 + 1000 * 3) / 123));
    expect(stats.meanMs).not.toBe(550);
  });

  it('sums the samples a rolled-up window stands for', () => {
    const metrics = [
      point({ sourceTier: 'hourly', sampleCount: 12 }),
      point({ sourceTier: 'hourly', sampleCount: 11 }),
    ];
    expect(summarize(metrics, 'hourly')!.sampleCount).toBe(23);
  });

  it('counts only hourly_approx buckets toward approxBuckets, out of the total bucketCount', () => {
    const metrics = [
      point({ sourceTier: 'daily', percentileSource: 'raw' }),
      point({ sourceTier: 'daily', percentileSource: 'hourly_approx' }),
      point({ sourceTier: 'daily', percentileSource: 'hourly_approx' }),
      point({ sourceTier: 'daily', percentileSource: 'raw' }),
      point({ sourceTier: 'daily', percentileSource: 'hourly_approx' }),
    ];
    const stats = summarize(metrics, 'daily')!;

    expect(stats.approxBuckets).toBe(3);
    expect(stats.bucketCount).toBe(5);
  });

  it('reports zero approxBuckets on the raw tier', () => {
    const metrics = [point(), point()];
    expect(summarize(metrics, 'raw')!.approxBuckets).toBe(0);
  });
});

describe('spansMoreThanADay / chartLabel', () => {
  it('is false for a window under 24h, and chartLabel omits the date', () => {
    const metrics = [
      point({ timestamp: '2026-09-12T00:00:00Z' }),
      point({ timestamp: '2026-09-12T12:00:00Z' }),
    ];
    expect(spansMoreThanADay(metrics)).toBe(false);
    expect(chartLabel(metrics[0].timestamp, false)).not.toMatch(/\d{4}|Sep/);
  });

  it('is true for a window over 24h, and chartLabel includes the date', () => {
    const metrics = [
      point({ timestamp: '2026-09-10T00:00:00Z' }),
      point({ timestamp: '2026-09-13T00:00:00Z' }),
    ];
    expect(spansMoreThanADay(metrics)).toBe(true);
    expect(chartLabel(metrics[0].timestamp, true)).toMatch(/Sep/);
  });

  it('is false for a single point or an empty window, which cannot span anything', () => {
    expect(spansMoreThanADay([point()])).toBe(false);
    expect(spansMoreThanADay([])).toBe(false);
  });

  it('is false for a window of exactly 24h, since the threshold is "more than"', () => {
    const metrics = [
      point({ timestamp: '2026-09-12T00:00:00Z' }),
      point({ timestamp: '2026-09-13T00:00:00Z' }),
    ];
    expect(spansMoreThanADay(metrics)).toBe(false);
  });
});

describe('coarsestTier', () => {
  it('returns raw for an empty window', () => {
    expect(coarsestTier([])).toBe('raw');
  });

  it('picks the coarsest tier present, regardless of row order', () => {
    // 'daily' sits in the middle, not first or last, so a buggy "first row
    // wins" or "last row wins" implementation would miss it.
    const metrics = [
      { sourceTier: 'raw' as const },
      { sourceTier: 'daily' as const },
      { sourceTier: 'hourly' as const },
    ];
    expect(coarsestTier(metrics)).toBe('daily');
  });

  it('returns raw when every row is raw', () => {
    const metrics = [{ sourceTier: 'raw' as const }, { sourceTier: 'raw' as const }];
    expect(coarsestTier(metrics)).toBe('raw');
  });
});

describe('bucketUptime', () => {
  it('is 100 for a fully successful bucket', () => {
    expect(bucketUptime(point({ successCount: 1, sampleCount: 1 }))).toBe(100);
  });

  it('is 0 for a fully failed bucket', () => {
    expect(bucketUptime(point({ successCount: 0, sampleCount: 1 }))).toBe(0);
  });

  it('is the right percentage for a partial bucket', () => {
    expect(bucketUptime(point({ successCount: 58, sampleCount: 60 }))).toBeCloseTo((58 / 60) * 100);
  });

  it('returns null rather than dividing by zero when sampleCount is 0', () => {
    expect(bucketUptime(point({ successCount: 0, sampleCount: 0 }))).toBeNull();
  });
});
