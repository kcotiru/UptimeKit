import { z } from 'zod';

export const uuidArg = z.string().uuid('Invalid id');

/**
 * Bounds the work one metrics call can ask for. 400 days, not the 30d preset:
 * the picker's custom inputs accept any range, and a wide window is cheap
 * because coarsestTier routes it to the hourly and daily rollups.
 */
export const MAX_WINDOW_DAYS = 400;

const timestamp = z.string().datetime({ offset: true, message: 'Invalid time window' });

export const metricsWindow = z
  .object({ id: uuidArg, from: timestamp, to: timestamp })
  .superRefine(({ from, to }, ctx) => {
    const span = Date.parse(to) - Date.parse(from);
    if (span <= 0) ctx.addIssue({ code: 'custom', message: 'End must be after start' });
    else if (span > MAX_WINDOW_DAYS * 86_400_000)
      ctx.addIssue({ code: 'custom', message: 'Time window is too wide' });
  });
