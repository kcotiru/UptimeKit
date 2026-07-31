import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationProcessor } from '../../src/worker/processors/notification-processor';
import * as undici from 'undici';

vi.mock('undici', () => ({
  request: vi.fn().mockResolvedValue({ statusCode: 200 }),
}));

describe('NotificationProcessor (Unit)', () => {
  let dbPoolMock: any;
  let clientMock: any;

  beforeEach(() => {
    clientMock = {
      query: vi.fn(),
      release: vi.fn(),
    };

    dbPoolMock = {
      connect: vi.fn().mockResolvedValue(clientMock),
    };

    vi.clearAllMocks();
  });

  it('formats Slack payload correctly and posts to Slack URL', async () => {
    clientMock.query
      .mockResolvedValueOnce({ rows: [{ provider: 'slack', url: 'https://hooks.slack.com/services/test' }] })
      .mockResolvedValueOnce({ rows: [{ url: 'https://example.com' }] });

    const processor = new NotificationProcessor(dbPoolMock);
    await processor.processNotification({
      teamId: 't-1',
      monitorId: 'm-1',
      incidentId: 'inc-1',
      status: 'down',
      cause: '500 Server Error',
    });

    expect(undici.request).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: '🚨 Monitor Down: https://example.com\nCause: 500 Server Error' }),
      })
    );
  });

  it('formats Discord payload correctly and posts to Discord URL', async () => {
    clientMock.query
      .mockResolvedValueOnce({ rows: [{ provider: 'discord', url: 'https://discord.com/api/webhooks/test' }] })
      .mockResolvedValueOnce({ rows: [{ url: 'https://example.com' }] });

    const processor = new NotificationProcessor(dbPoolMock);
    await processor.processNotification({
      teamId: 't-1',
      monitorId: 'm-1',
      incidentId: 'inc-1',
      status: 'up',
      cause: 'Monitor recovered',
    });

    expect(undici.request).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: '✅ Monitor Recovered: https://example.com' }),
      })
    );
  });

  it('formats Generic payload correctly and posts to Generic URL', async () => {
    clientMock.query
      .mockResolvedValueOnce({ rows: [{ provider: 'generic', url: 'https://api.mycompany.com/webhook' }] })
      .mockResolvedValueOnce({ rows: [{ url: 'https://example.com' }] });

    const processor = new NotificationProcessor(dbPoolMock);
    await processor.processNotification({
      teamId: 't-1',
      monitorId: 'm-1',
      incidentId: 'inc-1',
      status: 'down',
      cause: 'Connection Timeout',
    });

    expect(undici.request).toHaveBeenCalledWith(
      'https://api.mycompany.com/webhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          event: 'monitor.down',
          monitorId: 'm-1',
          incidentId: 'inc-1',
          url: 'https://example.com',
          cause: 'Connection Timeout',
        }),
      })
    );
  });
});
