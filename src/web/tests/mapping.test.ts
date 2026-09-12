import { describe, it, expect } from 'vitest';
import { toMonitor, toPingMetric } from '../lib/server/data/monitors';

const row = {
  id: 'm-1',
  team_id: 't-1',
  name: 'Prod API',
  url: 'https://api.example.com/health',
  check_interval: 60,
  timeout_ms: 5000,
  status: 'up',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T03:04:05.000Z',
};

describe('Supabase row mapping', () => {
  it('maps a monitor row to the client shape', () => {
    expect(toMonitor(row)).toMatchObject({
      id: 'm-1',
      teamId: 't-1',
      intervalSeconds: 60,
      status: 'up',
      lastCheckedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it("reports 'paused' monitors as unknown, since the UI has no paused state", () => {
    expect(toMonitor({ ...row, status: 'paused' }).status).toBe('unknown');
  });

  it('marks a raw ping down only on a missing or error status code', () => {
    const raw = {
      ts: '2026-01-01T00:00:00.000Z',
      response_time_ms: 12,
      min_time_ms: null,
      max_time_ms: null,
      p95_time_ms: null,
      sample_count: null,
      source_tier: 'raw',
    };
    expect(toPingMetric({ ...raw, status_code: 200 }).isUp).toBe(true);
    expect(toPingMetric({ ...raw, status_code: 500 }).isUp).toBe(false);
    expect(toPingMetric({ ...raw, status_code: null }).isUp).toBe(false);
  });

  it('treats rolled-up tiers as up, as they carry no per-ping status code', () => {
    const metric = toPingMetric({
      ts: '2026-01-01T00:00:00.000Z',
      response_time_ms: 12.6,
      min_time_ms: null,
      max_time_ms: null,
      p95_time_ms: null,
      sample_count: null,
      status_code: null,
      source_tier: 'hourly',
    });
    expect(metric.isUp).toBe(true);
    expect(metric.responseTimeMs).toBe(13);
  });

  it('carries the statistics the tier function already returns', () => {
    const metric = toPingMetric({
      ts: '2026-09-12T00:00:00Z',
      response_time_ms: 150,
      min_time_ms: 90,
      max_time_ms: 400,
      p95_time_ms: 380,
      sample_count: 12,
      status_code: 200,
      source_tier: 'hourly',
    });

    expect(metric.minMs).toBe(90);
    expect(metric.maxMs).toBe(400);
    expect(metric.p95Ms).toBe(380);
    expect(metric.sampleCount).toBe(12);
    expect(metric.sourceTier).toBe('hourly');
  });

  it('defaults sample count to one for a raw sample', () => {
    const metric = toPingMetric({
      ts: '2026-09-12T00:00:00Z',
      response_time_ms: 150,
      min_time_ms: null,
      max_time_ms: null,
      p95_time_ms: null,
      sample_count: null,
      status_code: 200,
      source_tier: 'raw',
    });

    expect(metric.sampleCount).toBe(1);
  });
});
