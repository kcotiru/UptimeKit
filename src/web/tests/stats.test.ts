import { describe, it, expect } from 'vitest';
import { percentile, summarize } from '../lib/shared/stats';
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

  it('computes exact percentiles on the raw tier', () => {
    const metrics = [100, 200, 300, 400].map((ms) => point({ responseTimeMs: ms }));
    const stats = summarize(metrics, 'raw')!;

    expect(stats.meanMs).toBe(250);
    expect(stats.p50Ms).toBe(250);
    expect(stats.p95Ms).toBe(385);
    expect(stats.tier).toBe('raw');
  });

  // A window p95 cannot be recovered from per-bucket summaries, so the rolled
  // up tiers must not claim one. This is the spec's central honesty rule.
  it('refuses to report window percentiles on rolled-up tiers', () => {
    const metrics = [100, 200].map((ms) => point({ responseTimeMs: ms, sourceTier: 'hourly', p95Ms: ms * 2 }));
    const stats = summarize(metrics, 'hourly')!;

    expect(stats.p50Ms).toBeNull();
    expect(stats.p95Ms).toBeNull();
    expect(stats.p99Ms).toBeNull();
  });

  it('reports the peak bucket p95 on the hourly tier, where buckets are exact', () => {
    const metrics = [
      point({ sourceTier: 'hourly', p95Ms: 300 }),
      point({ sourceTier: 'hourly', p95Ms: 900 }),
    ];
    expect(summarize(metrics, 'hourly')!.peakP95Ms).toBe(900);
  });

  // percentile_source never reaches the client, so a daily p95 may be a
  // percentile of percentiles with unbounded error. Report nothing.
  it('reports no percentile at all on the daily tier', () => {
    const metrics = [point({ sourceTier: 'daily', p95Ms: 900 })];
    const stats = summarize(metrics, 'daily')!;

    expect(stats.peakP95Ms).toBeNull();
    expect(stats.p95Ms).toBeNull();
  });

  it('measures uptime as the share of points that were up', () => {
    const metrics = [
      point({ isUp: true }),
      point({ isUp: true }),
      point({ isUp: true }),
      point({ isUp: false }),
    ];
    expect(summarize(metrics, 'raw')!.uptime).toBe(0.75);
  });

  it('sums the samples a rolled-up window stands for', () => {
    const metrics = [
      point({ sourceTier: 'hourly', sampleCount: 12 }),
      point({ sourceTier: 'hourly', sampleCount: 11 }),
    ];
    expect(summarize(metrics, 'hourly')!.sampleCount).toBe(23);
  });
});
