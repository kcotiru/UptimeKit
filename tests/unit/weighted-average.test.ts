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

  it('yields exactly 0, not null/undefined/NaN, for the all-zero-count case', () => {
    // Pins agreement with the SQL: NULLIF averts the division error, COALESCE
    // then maps that NULL back to 0 so avg_response_time_ms (NOT NULL) matches
    // this function's `if (total === 0) return 0` instead of diverging to NULL.
    const result = weightedAverage([{ avg: 0, count: 0 }]);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    expect(result).not.toBeNaN();
    expect(result).toBe(0);
  });

  it('matches the plain average when every hour has the same count', () => {
    const rows = [
      { avg: 100, count: 10 },
      { avg: 200, count: 10 },
    ];
    expect(weightedAverage(rows)).toBe(150);
  });
});
