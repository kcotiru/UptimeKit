import { describe, it, expect } from 'vitest';
import { createMonitorSchema } from '../lib/validations/monitor';

describe('Monitor Validation Schemas (SC-002)', () => {
  it('passes validation for valid HTTP/HTTPS URLs', () => {
    const validData = {
      name: 'Production API',
      url: 'https://api.example.com/health',
      intervalSeconds: 60,
      timeoutMs: 5000,
    };
    const result = createMonitorSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('fails instantly on invalid URLs without network requests', () => {
    const invalidData = {
      name: 'Bad Monitor',
      url: 'invalid-url-string',
      intervalSeconds: 60,
      timeoutMs: 5000,
    };
    const result = createMonitorSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('valid public URL');
    }
  });

  it('fails on intervals below the 30s database floor', () => {
    const invalidData = {
      name: 'Too Fast',
      url: 'https://api.example.com',
      intervalSeconds: 15,
      timeoutMs: 5000,
    };
    const result = createMonitorSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});
