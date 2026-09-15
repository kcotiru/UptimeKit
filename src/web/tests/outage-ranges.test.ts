import { describe, it, expect } from 'vitest';
import { outageRanges } from '../lib/shared/stats';

function points(...isUp: boolean[]) {
  return isUp.map((up, i) => ({ time: `t${i}`, isUp: up }));
}

describe('outageRanges', () => {
  it('returns nothing when every point is up', () => {
    expect(outageRanges(points(true, true, true))).toEqual([]);
  });

  it('finds one outage in the middle', () => {
    expect(outageRanges(points(true, false, false, true))).toEqual([{ from: 't1', to: 't2' }]);
  });

  it('finds an outage at the very start', () => {
    expect(outageRanges(points(false, false, true, true))).toEqual([{ from: 't0', to: 't1' }]);
  });

  it('finds an outage at the very end', () => {
    expect(outageRanges(points(true, true, false, false))).toEqual([{ from: 't2', to: 't3' }]);
  });

  it('finds two separate outages', () => {
    expect(outageRanges(points(false, false, true, true, false, false))).toEqual([
      { from: 't0', to: 't1' },
      { from: 't4', to: 't5' },
    ]);
  });

  it('treats every point down as one outage spanning the whole window', () => {
    expect(outageRanges(points(false, false, false))).toEqual([{ from: 't0', to: 't2' }]);
  });

  it('returns nothing for an empty window', () => {
    expect(outageRanges([])).toEqual([]);
  });
});
