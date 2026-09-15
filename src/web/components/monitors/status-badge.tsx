import { MonitorStatus } from '@/lib/shared/types';
import { cn } from '@/lib/shared/utils';

export interface StatusWordProps {
  status: MonitorStatus;
  className?: string;
}

/**
 * The monitor's state, as a word.
 *
 * Colour is carried by the text and never by a fill, a pill or a dot: a
 * healthy board stays near-monochrome so the one unhealthy row is impossible
 * to miss. The word is always present, which is also what makes this readable
 * without colour vision.
 */
export function StatusWord({ status, className }: StatusWordProps) {
  const labels: Record<MonitorStatus, string> = {
    up: 'up',
    down: 'down',
    degraded: 'degraded',
    unknown: 'not checked yet',
  };

  const tones: Record<MonitorStatus, string> = {
    up: 'text-status-up',
    down: 'text-status-down',
    degraded: 'text-status-degraded',
    unknown: 'text-slate-400',
  };

  return (
    <span className={cn('text-sm font-medium', tones[status], className)}>
      {labels[status] ?? labels.unknown}
    </span>
  );
}
