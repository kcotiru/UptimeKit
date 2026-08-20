import { z } from 'zod';
import { publicUrl } from './public-url';

export const createWebhookSchema = z.object({
  // Must match the provider CHECK constraint in supabase/schema.sql.
  provider: z.enum(['slack', 'discord', 'generic']),
  url: publicUrl,
});

export type CreateWebhookSchema = z.infer<typeof createWebhookSchema>;
