import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TimeRangePreset } from '@/components/monitors/time-range-picker';

/**
 * Combines Tailwind CSS class names with automatic conflict resolution.
 * @param inputs - Array of class names or conditional class objects
 * @returns Merged Tailwind class string
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formats an ISO date string into a localized, human-readable date string.
 * @param isoString - ISO 8601 timestamp string or null
 * @returns Formatted date string or 'Never' if null
 */
export function formatDate(isoString: string | null): string {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/**
 * Formats response duration milliseconds into display string.
 * @param ms - Duration in milliseconds or null
 * @returns Formatted ms string or '-- ms' if null
 */
export function formatMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '-- ms';
  return `${Math.round(ms)} ms`;
}

/**
 * Calculates start and end ISO timestamps for a given time range preset.
 * @param preset - Time range preset identifier ('1h', '24h', '7d', '30d', 'custom')
 * @returns Object containing ISO 8601 from and to timestamp strings
 */
export function calculateTimestamps(preset: TimeRangePreset): { from: string; to: string } {
  const now = new Date();
  let from = new Date();
  if (preset === '1h') from.setHours(now.getHours() - 1);
  else if (preset === '24h') from.setHours(now.getHours() - 24);
  else if (preset === '7d') from.setDate(now.getDate() - 7);
  else if (preset === '30d') from.setDate(now.getDate() - 30);

  return {
    from: from.toISOString(),
    to: now.toISOString(),
  };
}
