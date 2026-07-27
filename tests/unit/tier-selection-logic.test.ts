import { describe, it, expect } from 'vitest';

export function determineTiers(startTime: Date, endTime: Date, referenceNow: Date = new Date()): string[] {
  const rawCutoff = new Date(referenceNow.getTime() - 7 * 24 * 60 * 60 * 1000);
  const hourlyCutoff = new Date(referenceNow.getTime() - 90 * 24 * 60 * 60 * 1000);

  const tiers: string[] = [];

  if (endTime >= rawCutoff && startTime <= referenceNow) {
    tiers.push('raw');
  }
  if (startTime < rawCutoff && endTime >= hourlyCutoff) {
    tiers.push('hourly');
  }
  if (startTime < hourlyCutoff) {
    tiers.push('daily');
  }

  return tiers;
}

describe('Tier Selection Logic Unit Tests', () => {
  const now = new Date('2026-07-27T12:00:00Z');

  it('selects raw tier for queries within 7 days', () => {
    const start = new Date('2026-07-26T12:00:00Z');
    const end = new Date('2026-07-27T12:00:00Z');
    expect(determineTiers(start, end, now)).toEqual(['raw']);
  });

  it('selects hourly tier for queries between 7d and 90d', () => {
    const start = new Date('2026-06-01T00:00:00Z');
    const end = new Date('2026-07-15T00:00:00Z');
    expect(determineTiers(start, end, now)).toEqual(['hourly']);
  });

  it('selects daily tier for queries older than 90d', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-03-01T00:00:00Z');
    expect(determineTiers(start, end, now)).toEqual(['daily']);
  });

  it('selects multiple tiers when crossing cutoff boundaries', () => {
    const start = new Date('2026-07-15T00:00:00Z'); // 12d ago -> hourly
    const end = new Date('2026-07-27T12:00:00Z');   // now -> raw
    expect(determineTiers(start, end, now)).toEqual(['raw', 'hourly']);
  });
});
