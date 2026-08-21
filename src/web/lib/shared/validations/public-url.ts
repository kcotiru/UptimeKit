import { z } from 'zod';

/**
 * A public http(s) URL. Rejects the hostnames an attacker would use to point a
 * monitor or a webhook at infrastructure behind the worker.
 *
 * This is the fast, offline half of the check — it never resolves DNS, so a
 * hostname that resolves to a private address still passes here. The worker's
 * SSRFValidator (src/shared/security) is the real boundary and re-checks at
 * send time; this exists to fail obvious mistakes instantly in the form.
 */
export const publicUrl = z
  .string()
  .min(1, 'URL is required')
  .refine((val) => {
    try {
      const parsed = new URL(val);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      const hostname = parsed.hostname.toLowerCase();

      const isPrivate =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '0.0.0.0' ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
        /^169\.254\./.test(hostname) ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal');

      return !isPrivate;
    } catch {
      return false;
    }
  }, 'Please enter a valid public URL (private and internal IP ranges are forbidden)');
