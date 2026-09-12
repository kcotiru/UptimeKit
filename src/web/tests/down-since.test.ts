import { describe, it, expect } from 'vitest';
import { downSinceLabel } from '../lib/shared/utils';

const NOW = new Date('2026-09-12T12:00:00Z').getTime();
const WINDOW_HOURS = 3;

describe('downSinceLabel', () => {
  it('uses the last successful sample when one exists in the window', () => {
    const lastUp = new Date(NOW - 4 * 60_000).toISOString(); // 4 minutes ago
    // Monitor age is irrelevant once we have a real last-up sample.
    const createdAt = new Date(NOW - 30 * 86_400_000).toISOString(); // 30 days old
    expect(downSinceLabel(createdAt, lastUp, WINDOW_HOURS, NOW)).toBe('down for 4m');
  });

  it('falls back to creation time, not "over 3h", for a monitor younger than the window', () => {
    const createdAt = new Date(NOW - 5 * 60_000).toISOString(); // 5 minutes old
    expect(downSinceLabel(createdAt, null, WINDOW_HOURS, NOW)).toBe('down for 5m');
  });

  it('reads "down for over Xh" when the monitor predates the window and never succeeded in it', () => {
    const createdAt = new Date(NOW - 2 * 86_400_000).toISOString(); // 2 days old
    expect(downSinceLabel(createdAt, null, WINDOW_HOURS, NOW)).toBe('down for over 3h');
  });

  it('treats a monitor created exactly at the window boundary as not younger than the window', () => {
    // createdMs === windowStartMs is not "> windowStartMs", so this takes the
    // unbounded branch rather than claiming a bounded age of exactly 3h.
    const createdAt = new Date(NOW - WINDOW_HOURS * 3600 * 1000).toISOString();
    expect(downSinceLabel(createdAt, null, WINDOW_HOURS, NOW)).toBe('down for over 3h');
  });

  it('prefers the last-up sample over creation time when both are available', () => {
    const lastUp = new Date(NOW - 90_000).toISOString(); // 1.5 minutes ago
    const createdAt = new Date(NOW - 2 * 60_000).toISOString(); // 2 minutes old, also within window
    expect(downSinceLabel(createdAt, lastUp, WINDOW_HOURS, NOW)).toBe('down for 1m');
  });
});
