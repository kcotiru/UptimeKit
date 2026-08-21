import { z } from 'zod';
import { publicUrl } from './public-url';

export const createMonitorSchema = z.object({
  name: z.string().min(1, 'Monitor name is required').max(100, 'Monitor name must not exceed 100 characters'),
  url: publicUrl,
  intervalSeconds: z
    .number()
    // Must match the check_interval CHECK constraint in supabase/schema.sql.
    .min(30, 'Interval must be at least 30 seconds')
    .max(86400, 'Interval must not exceed 86,400 seconds')
    .default(60),
  timeoutMs: z
    .number()
    .min(1000, 'Timeout must be at least 1,000 ms')
    .max(30000, 'Timeout must not exceed 30,000 ms')
    .default(5000),
});

export type CreateMonitorSchema = z.infer<typeof createMonitorSchema>;
