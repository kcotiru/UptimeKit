import type { Tier } from '@/lib/shared/types';

const NOTES: Partial<Record<Tier, string>> = {
  hourly:
    'This window is rolled up to hourly averages. Each hour’s p95 is exact; a single figure for the whole window is not.',
  daily:
    'This window is rolled up to daily averages. Percentiles at this range are approximate and are not shown.',
};

/** Says when the numbers above it are summaries rather than samples. */
export function TierNote({ tier }: { tier: Tier }) {
  const note = NOTES[tier];
  if (!note) return null;

  return <p className="text-xs text-status-degraded">{note}</p>;
}
