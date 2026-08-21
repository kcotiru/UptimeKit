import { MonitorStatus } from '@/lib/shared/types';
import { cn } from '@/lib/shared/utils';

/**
 * Props for the StatusBadge component.
 */
export interface StatusBadgeProps {
  /** Target monitor operational status enum */
  status: MonitorStatus;
  /** Optional additional CSS class names */
  className?: string;
}

/**
 * StatusBadge component presenting monitor operational status with colored glowing indicators.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const configs: Record<MonitorStatus, { label: string; bg: string; text: string; dot: string; glow?: string }> = {
    up: {
      label: 'Operational',
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      text: 'text-emerald-400',
      dot: 'bg-emerald-500',
      glow: 'glow-emerald',
    },
    down: {
      label: 'Offline',
      bg: 'bg-red-500/10 border-red-500/30',
      text: 'text-red-400',
      dot: 'bg-red-500',
      glow: 'glow-red',
    },
    degraded: {
      label: 'Degraded',
      bg: 'bg-amber-500/10 border-amber-500/30',
      text: 'text-amber-400',
      dot: 'bg-amber-500',
    },
    unknown: {
      label: 'Pending Check',
      bg: 'bg-slate-500/10 border-slate-500/30',
      text: 'text-slate-400',
      dot: 'bg-slate-500',
    },
  };

  const config = configs[status] || configs.unknown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border transition-all',
        config.bg,
        config.text,
        config.glow,
        className
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}
