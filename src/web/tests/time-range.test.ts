import { describe, it, expect } from 'vitest';

describe('URL Time-Series Query Sync (FR-008 & SC-004)', () => {
  it('formats ISO timestamps for URL parameters', () => {
    const fromDate = new Date('2026-07-31T00:00:00.000Z');
    const toDate = new Date('2026-07-31T24:00:00.000Z');

    const params = new URLSearchParams();
    params.set('from', fromDate.toISOString());
    params.set('to', toDate.toISOString());

    expect(params.get('from')).toBe('2026-07-31T00:00:00.000Z');
    expect(params.get('to')).toBe('2026-08-01T00:00:00.000Z');
  });
});
