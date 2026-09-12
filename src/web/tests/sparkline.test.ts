import { describe, it, expect } from 'vitest';
import { sparklinePath } from '../lib/shared/sparkline';
import { formatRelative } from '../lib/shared/utils';

describe('sparklinePath', () => {
  it('returns an empty string when there is nothing to draw', () => {
    expect(sparklinePath([], 100, 20)).toBe('');
  });

  it('draws a flat line through the middle for a single value', () => {
    expect(sparklinePath([5], 100, 20)).toBe('M 0 10 L 100 10');
  });

  // A flat series has no range; dividing by zero would produce NaN in the path
  // and the SVG would silently render nothing.
  it('draws a flat line rather than NaN when every value is equal', () => {
    const path = sparklinePath([7, 7, 7], 100, 20);
    expect(path).not.toContain('NaN');
    expect(path).toBe('M 0 10 L 50 10 L 100 10');
  });

  it('puts the lowest value at the bottom and the highest at the top', () => {
    // y is inverted: 0 is the top of an SVG viewport.
    expect(sparklinePath([0, 10], 100, 20)).toBe('M 0 20 L 100 0');
  });
});

describe('formatRelative', () => {
  it('reads never when there is no timestamp', () => {
    expect(formatRelative(null)).toBe('never');
  });

  it('counts seconds, then minutes, then hours, then days', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 12_000).toISOString())).toBe('12s ago');
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(formatRelative(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h ago');
    expect(formatRelative(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });
});
