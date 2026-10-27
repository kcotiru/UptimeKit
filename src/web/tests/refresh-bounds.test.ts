import { describe, it, expect } from 'vitest';
import { refreshBounds } from '../lib/shared/utils';

describe('refreshBounds', () => {
  const known = { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' };

  it('keeps the original bounds when refreshing a custom range', () => {
    expect(refreshBounds('custom', known)).toEqual(known);
  });

  it('recomputes a preset window as now', () => {
    const b = refreshBounds('1h', known);
    expect(new Date(b.to).getTime() - new Date(b.from).getTime()).toBeGreaterThan(0);
    expect(b.to).not.toBe(known.to);
  });
});
