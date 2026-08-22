import { describe, it, expect } from 'vitest';
import { createSavedViewSchema } from '../lib/shared/validations/saved-view';
import { toSavedView, toSharedView } from '../lib/server/data/saved-views';

describe('createSavedViewSchema', () => {
  const valid = {
    monitorId: '11111111-1111-1111-1111-111111111111',
    name: 'Feb outage',
    from: '2026-02-14T02:00:00.000Z',
    to: '2026-02-14T06:00:00.000Z',
  };

  it('accepts a well-formed window', () => {
    expect(createSavedViewSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a window that ends before it starts', () => {
    const result = createSavedViewSchema.safeParse({ ...valid, to: '2026-02-14T01:00:00.000Z' });
    expect(result.success).toBe(false);
  });

  it('rejects a zero-length window', () => {
    const result = createSavedViewSchema.safeParse({ ...valid, to: valid.from });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(createSavedViewSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
  });
});

describe('toSavedView', () => {
  it('lifts the window out of the configuration jsonb', () => {
    const view = toSavedView({
      id: 'v1',
      team_id: 't1',
      monitor_id: 'm1',
      name: 'Feb outage',
      configuration: { from: '2026-02-14T02:00:00.000Z', to: '2026-02-14T06:00:00.000Z' },
      share_token: 'a'.repeat(43),
      revoked_at: null,
      created_at: '2026-02-15T00:00:00.000Z',
    });

    expect(view.from).toBe('2026-02-14T02:00:00.000Z');
    expect(view.to).toBe('2026-02-14T06:00:00.000Z');
    expect(view.revokedAt).toBeNull();
  });
});

describe('toSharedView', () => {
  const rows = [
    {
      view_name: 'Feb outage',
      monitor_name: 'Checkout API',
      monitor_status: 'down',
      window_from: '2026-02-14T02:00:00.000Z',
      window_to: '2026-02-14T06:00:00.000Z',
      ts: '2026-02-14T02:30:00.000Z',
      response_time_ms: 412.4,
      min_time_ms: 400,
      max_time_ms: 430,
      p95_time_ms: 428,
      sample_count: 1,
      source_tier: 'raw',
    },
  ];

  it('folds repeated header columns into one object with a point list', () => {
    const shared = toSharedView(rows);
    expect(shared?.viewName).toBe('Feb outage');
    expect(shared?.monitorName).toBe('Checkout API');
    expect(shared?.points).toHaveLength(1);
    expect(shared?.points[0].responseTimeMs).toBe(412);
  });

  it('reports the coarsest tier present, so the page can say the data is approximate', () => {
    // 'daily' sits in the middle, not last, so a buggy "last row wins"
    // implementation would report 'hourly' here instead of 'daily'.
    const mixed = [
      { ...rows[0], source_tier: 'raw' },
      { ...rows[0], source_tier: 'daily' },
      { ...rows[0], source_tier: 'hourly' },
    ];
    expect(toSharedView(mixed)?.sourceTier).toBe('daily');
  });

  it('returns null for an unknown or revoked token, which yields zero rows', () => {
    expect(toSharedView([])).toBeNull();
  });
});
