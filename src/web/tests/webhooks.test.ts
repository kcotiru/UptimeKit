import { describe, it, expect } from 'vitest';
import { createWebhookSchema } from '../lib/validations/webhook';
import { toWebhook } from '../lib/webhooks';

describe('createWebhookSchema', () => {
  it('accepts a public https webhook for a known provider', () => {
    const result = createWebhookSchema.safeParse({
      provider: 'slack',
      url: 'https://hooks.slack.com/services/T000/B000/xxx',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a provider outside the database CHECK constraint', () => {
    const result = createWebhookSchema.safeParse({
      provider: 'telegram',
      url: 'https://example.com/hook',
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data'],
    ['loopback', 'http://127.0.0.1:6379/'],
    ['localhost', 'http://localhost:3001/hook'],
    ['private range', 'http://10.0.0.5/hook'],
    ['internal suffix', 'https://admin.internal/hook'],
  ])('rejects a %s URL', (_label, url) => {
    expect(createWebhookSchema.safeParse({ provider: 'generic', url }).success).toBe(false);
  });

  it('rejects a non-http scheme', () => {
    const result = createWebhookSchema.safeParse({ provider: 'generic', url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });
});

describe('toWebhook', () => {
  it('maps a webhook row to the client shape', () => {
    expect(
      toWebhook({
        id: 'w-1',
        team_id: 't-1',
        provider: 'discord',
        url: 'https://discord.com/api/webhooks/1/x',
        created_at: '2026-01-01T00:00:00.000Z',
      })
    ).toEqual({
      id: 'w-1',
      teamId: 't-1',
      provider: 'discord',
      url: 'https://discord.com/api/webhooks/1/x',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
