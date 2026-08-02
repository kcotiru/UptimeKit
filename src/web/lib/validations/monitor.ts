import { z } from 'zod';

export const createMonitorSchema = z.object({
  name: z.string().min(1, 'Monitor name is required').max(100, 'Monitor name must not exceed 100 characters'),
  url: z
    .string()
    .min(1, 'URL is required')
    .refine((val) => {
      try {
        const parsed = new URL(val);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const hostname = parsed.hostname.toLowerCase();
        
        // SSRF protection: reject private/internal IP ranges and local hostnames
        const isPrivate =
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname === '0.0.0.0' ||
          /^10\./.test(hostname) ||
          /^192\.168\./.test(hostname) ||
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
          hostname.endsWith('.local') ||
          hostname.endsWith('.internal');
          
        return !isPrivate;
      } catch {
        return false;
      }
    }, 'Please enter a valid public URL (private and internal IP ranges are forbidden)'),
  intervalSeconds: z
    .number()
    .min(10, 'Interval must be at least 10 seconds')
    .max(86400, 'Interval must not exceed 86,400 seconds')
    .default(60),
  timeoutMs: z
    .number()
    .min(1000, 'Timeout must be at least 1,000 ms')
    .max(30000, 'Timeout must not exceed 30,000 ms')
    .default(5000),
});

export type CreateMonitorSchema = z.infer<typeof createMonitorSchema>;
