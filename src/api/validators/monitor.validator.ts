import { z } from 'zod';

export const createMonitorSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url().refine((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, { message: 'Must be a valid HTTP/HTTPS URL' }),
  http_method: z.enum(['GET', 'POST', 'PUT']),
  expected_status: z.number().int().min(200).max(599),
  check_interval: z.number().int().min(30)
});

export const updateMonitorSchema = createMonitorSchema.partial();

export const paginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
