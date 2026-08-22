import { describe, it, expect } from 'vitest';
import { weightedAverage } from '../../src/worker/processors/rollup-processor';

describe('weightedAverage', () => {
  it('weights each hour by its ping count, not equally', () => {
    // A quiet hour of 2 slow pings and a busy hour of 100 fast ones.
    // Unweighted AVG gives 550ms and libels the service; weighted gives ~118ms.
    const rows = [
      { avg: 1000, count: 2 },
      { avg: 100, count: 100 },
    ];
    expect(weightedAverage(rows)).toBe(118);
  });

  it('returns 0 rather than dividing by zero when every hour is empty', () => {
    expect(weightedAverage([{ avg: 0, count: 0 }])).toBe(0);
  });

  it('matches the plain average when every hour has the same count', () => {
    const rows = [
      { avg: 100, count: 10 },
      { avg: 200, count: 10 },
    ];
    expect(weightedAverage(rows)).toBe(150);
  });
});
