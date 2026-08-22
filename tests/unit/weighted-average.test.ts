import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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

describe('hourly_to_daily SQL: avg_response_time_ms can never be NULL', () => {
  it('wraps the NULLIF division in COALESCE so an all-empty day inserts 0, not NULL', () => {
    // weightedAverage() above returns 0 for an all-zero-count input, but that
    // TS function is not what actually runs the rollup -- the SQL string in
    // rollup-processor.ts is. NULLIF(SUM(total_pings), 0) alone would make the
    // division (and the whole ROUND(...)::int) evaluate to SQL NULL on that
    // input, which violates ping_logs_daily.avg_response_time_ms's NOT NULL
    // constraint and aborts the insert. Only COALESCE(..., 0) around the
    // division actually prevents that. This test reads the source as text and
    // fails if that COALESCE wrapper is ever removed or unwrapped.
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/worker/processors/rollup-processor.ts'),
      'utf8'
    );
    const hourlyToDaily = source.slice(source.indexOf("rollupType === 'hourly_to_daily'"));
    expect(hourlyToDaily.length).toBeGreaterThan(0);

    // Isolate just the avg_response_time_ms computation within that query,
    // so this can't accidentally match some unrelated COALESCE/NULLIF elsewhere.
    const avgExpr = hourlyToDaily.slice(
      hourlyToDaily.indexOf('SUM(successful_pings)'),
      hourlyToDaily.indexOf('MIN(min_response_time_ms)')
    );

    expect(avgExpr).toMatch(/NULLIF\(SUM\(total_pings\),\s*0\)/);
    // The discriminating check: COALESCE must actually wrap the NULLIF division,
    // not just appear somewhere nearby.
    expect(avgExpr).toMatch(/COALESCE\([\s\S]*NULLIF\(SUM\(total_pings\),\s*0\)[\s\S]*\)/);
  });
});
