import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Monitor, MonitorStatus, TimeRangePreset } from './types';

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
 * Renders a timestamp as elapsed time. A dashboard reader wants "12s ago",
 * not an absolute clock time they have to subtract from.
 * @param isoString ISO 8601 timestamp or null
 */
export function formatRelative(isoString: string | null): string {
  if (!isoString) return 'never';

  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Elapsed time with no suffix, for phrases like "down for 4m". */
export function formatDuration(isoString: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Lower sorts first. Anything needing attention outranks anything healthy. */
const URGENCY: Record<MonitorStatus, number> = {
  down: 0,
  degraded: 1,
  unknown: 2,
  up: 3,
};

/**
 * Orders monitors by how much they need a human, then by name so the list does
 * not reshuffle between renders.
 */
export function byUrgency(a: Monitor, b: Monitor): number {
  return URGENCY[a.status] - URGENCY[b.status] || a.name.localeCompare(b.name);
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
  const from = new Date();
  if (preset === '1h') from.setHours(now.getHours() - 1);
  else if (preset === '24h') from.setHours(now.getHours() - 24);
  else if (preset === '7d') from.setDate(now.getDate() - 7);
  else if (preset === '30d') from.setDate(now.getDate() - 30);

  return {
    from: from.toISOString(),
    to: now.toISOString(),
  };
}
