import { z } from 'zod';

export const createSavedViewSchema = z
  .object({
    monitorId: z.string().uuid('A monitor is required'),
    name: z.string().min(1, 'Name is required').max(255, 'Name must not exceed 255 characters'),
    from: z.string().datetime('Window start must be an ISO 8601 timestamp'),
    to: z.string().datetime('Window end must be an ISO 8601 timestamp'),
  })
  // Windows are absolute and pinned, so an inverted or empty one is never a
  // transient UI state — it is always a bug worth rejecting at the boundary.
  .refine((v) => new Date(v.to) > new Date(v.from), {
    message: 'Window end must be after its start',
    path: ['to'],
  });

export type CreateSavedViewSchema = z.infer<typeof createSavedViewSchema>;
