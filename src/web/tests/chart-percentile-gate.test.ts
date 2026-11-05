import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chartPoint, p95Label } from '../components/monitors/time-series-chart';
import { TierNote } from '../components/monitors/tier-note';
import type { PingMetric, Tier } from '../lib/shared/types';

function point(o: {
  sourceTier: Tier;
  sampleCount: number;
  p95Ms: number | null;
  percentileSource?: PingMetric['percentileSource'];
}): PingMetric {
  return {
    timestamp: '2026-11-01T10:00:00.000Z',
    responseTimeMs: 200,
    statusCode: null,
    isUp: true,
    minMs: 100,
    maxMs: 500,
    p50Ms: null,
    p99Ms: null,
    percentileSource: null,
    successCount: o.sampleCount,
    ...o,
  };
}

describe('chart per-point p95 gate', () => {
  it('keeps a rolled-up bucket p95 at exactly twenty samples', () => {
    expect(chartPoint(point({ sourceTier: 'hourly', sampleCount: 20, p95Ms: 300 }), false).p95).toBe(300);
  });

  it('drops a rolled-up bucket p95 at nineteen samples', () => {
    expect(chartPoint(point({ sourceTier: 'hourly', sampleCount: 19, p95Ms: 300 }), false).p95).toBeNull();
  });

  it('drops the p95 of a single-ping hourly bucket', () => {
    expect(chartPoint(point({ sourceTier: 'hourly', sampleCount: 1, p95Ms: 480 }), false).p95).toBeNull();
  });

  it('leaves a null p95 null', () => {
    expect(chartPoint(point({ sourceTier: 'raw', sampleCount: 1, p95Ms: null }), false).p95).toBeNull();
  });
});

describe('chart p95 tooltip label', () => {
  // A day built from two 15-ping hours: 30 pings clear the gate, but the p95 is
  // interpolated between two hourly p95s, not taken over the day's pings.
  const approxDay = point({ sourceTier: 'daily', sampleCount: 30, p95Ms: 300, percentileSource: 'hourly_approx' });

  it('keeps an approximate daily p95 on the chart but labels it approximate', () => {
    const row = chartPoint(approxDay, true);
    expect(row.p95).toBe(300);
    expect(p95Label(row)).toBe('approx. p95');
  });

  it('labels a daily p95 taken over raw pings plainly', () => {
    const row = chartPoint(point({ sourceTier: 'daily', sampleCount: 30, p95Ms: 300, percentileSource: 'raw' }), true);
    expect(p95Label(row)).toBe('p95');
  });

  it('labels an hourly p95 plainly', () => {
    expect(p95Label(chartPoint(point({ sourceTier: 'hourly', sampleCount: 20, p95Ms: 300 }), false))).toBe('p95');
  });
});

describe('tier note', () => {
  it('does not claim an hourly p95 is exact', () => {
    const html = renderToStaticMarkup(createElement(TierNote, { tier: 'hourly' }));
    expect(html).not.toContain('is exact');
    expect(html).toContain('that hour had enough pings to support one');
  });
});
