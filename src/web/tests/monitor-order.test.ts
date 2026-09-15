import { describe, it, expect } from 'vitest';
import { byUrgency } from '../lib/shared/utils';
import type { Monitor, MonitorStatus } from '../lib/shared/types';

function monitor(name: string, status: MonitorStatus): Monitor {
  return {
    id: name,
    teamId: 't1',
    name,
    url: `https://${name}.test`,
    intervalSeconds: 300,
    timeoutMs: 10000,
    status,
    lastCheckedAt: '2026-09-12T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
  };
}

describe('byUrgency', () => {
  // The whole point of the redesign: a broken endpoint must not sit below a
  // healthy one just because it was created later.
  it('puts down first, then degraded, then unchecked, then up', () => {
    const sorted = [
      monitor('d', 'up'),
      monitor('c', 'unknown'),
      monitor('b', 'degraded'),
      monitor('a', 'down'),
    ]
      .sort(byUrgency)
      .map((m) => m.name);

    expect(sorted).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to name so the order is stable between renders', () => {
    const sorted = [monitor('zeta', 'up'), monitor('alpha', 'up')].sort(byUrgency).map((m) => m.name);
    expect(sorted).toEqual(['alpha', 'zeta']);
  });
});
