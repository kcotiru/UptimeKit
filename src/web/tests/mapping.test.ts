import { describe, it, expect } from 'vitest';
import { toMonitor, toPingMetric } from '../lib/server/data/monitors';

const row = {
  id: 'm-1',
  team_id: 't-1',
  name: 'Prod API',
  url: 'https://api.example.com/health',
  check_interval: 60,
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
    const raw = { ts: '2026-01-01T00:00:00.000Z', response_time_ms: 12, source_tier: 'raw' };
    expect(toPingMetric({ ...raw, status_code: 200 }).isUp).toBe(true);
    expect(toPingMetric({ ...raw, status_code: 500 }).isUp).toBe(false);
    expect(toPingMetric({ ...raw, status_code: null }).isUp).toBe(false);
  });

  it('treats rolled-up tiers as up, as they carry no per-ping status code', () => {
    const metric = toPingMetric({
      ts: '2026-01-01T00:00:00.000Z',
      response_time_ms: 12.6,
      status_code: null,
      source_tier: 'hourly',
    });
    expect(metric.isUp).toBe(true);
    expect(metric.responseTimeMs).toBe(13);
  });
});
