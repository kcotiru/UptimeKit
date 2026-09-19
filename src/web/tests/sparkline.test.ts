import { describe, it, expect } from 'vitest';
import { sparklinePath, downsample } from '../lib/shared/sparkline';
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

describe('downsample', () => {
  it('returns a shorter-than-cap series unchanged', () => {
    expect(downsample([1, 2, 3], 48)).toEqual([1, 2, 3]);
  });

  it('thins a long series to exactly max points', () => {
    const values = Array.from({ length: 500 }, (_, i) => i);
    expect(downsample(values, 48)).toHaveLength(48);
  });

  it('always keeps the first and last elements', () => {
    const values = Array.from({ length: 500 }, (_, i) => i);
    const thinned = downsample(values, 48);
    expect(thinned[0]).toBe(0);
    expect(thinned[thinned.length - 1]).toBe(499);
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

// formatRelative is rendered inside client components, which Next renders
// twice: once on the server for the initial HTML, then again on hydration.
// If it reads the clock itself those two passes disagree the moment the gap
// crosses a unit boundary, and React reports a hydration mismatch. The
// injectable clock is what makes both passes produce the same string.
describe('formatRelative determinism across a hydration gap', () => {
  const iso = new Date(1_000_000_000_000).toISOString();

  it('returns the same string for the same clock', () => {
    expect(formatRelative(iso, 1_000_000_012_000)).toBe('12s ago');
    expect(formatRelative(iso, 1_000_000_012_000)).toBe('12s ago');
  });

  it('would differ across a one-second gap — the mismatch being prevented', () => {
    expect(formatRelative(iso, 1_000_000_012_000)).toBe('12s ago');
    expect(formatRelative(iso, 1_000_000_013_000)).toBe('13s ago');
  });

  it('still defaults to the real clock when no time is given', () => {
    expect(formatRelative(new Date().toISOString())).toBe('0s ago');
  });
});
