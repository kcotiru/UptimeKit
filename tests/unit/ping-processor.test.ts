import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PingProcessor } from '../../src/worker/processors/ping-processor';
import { workerConfig } from '../../src/worker/config/worker-config';

describe('PingProcessor (Unit)', () => {
  let ssrfValidatorMock: any;
  let pingClientMock: any;
  let dbPoolMock: any;
  let clientMock: any;
  let notificationQueueMock: any;

  beforeEach(() => {
    ssrfValidatorMock = {
      validateUrl: vi.fn().mockResolvedValue({ isAllowed: true, resolvedIp: '1.2.3.4' }),
    };

    pingClientMock = {
      executePing: vi.fn().mockResolvedValue({
        responseTimeMs: 50,
        statusCode: 200,
        errorMessage: null,
      }),
    };

    clientMock = {
      query: vi.fn(),
      release: vi.fn(),
    };

    dbPoolMock = {
      connect: vi.fn().mockResolvedValue(clientMock),
    };

    notificationQueueMock = {
      add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    };

    workerConfig.defaultFailureThreshold = 3;
  });

  it('should trigger an incident and notify down when consecutive failure threshold is reached', async () => {
    // Setup mock query responses
    clientMock.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // INSERT ping_logs_raw
      .mockResolvedValueOnce({ rows: [{ consecutive_failures: 3 }] }) // UPDATE monitors
      .mockResolvedValueOnce({}) // INSERT incidents
      .mockResolvedValueOnce({}); // COMMIT

    pingClientMock.executePing.mockResolvedValueOnce({
      responseTimeMs: 0,
      statusCode: 500,
      errorMessage: 'Internal Server Error',
    });

    const processor = new PingProcessor(
      ssrfValidatorMock,
      pingClientMock,
      dbPoolMock,
      notificationQueueMock
    );

    const result = await processor.processPing({
      monitorId: 'm-1',
      teamId: 't-1',
      url: 'http://example.com',
      expectedStatus: 200,
    });

    expect(result.status).toBe('down');
    expect(clientMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO incidents'),
      expect.any(Array)
    );
    expect(notificationQueueMock.add).toHaveBeenCalledWith('notify-down', expect.objectContaining({
      monitorId: 'm-1',
      teamId: 't-1',
      status: 'down',
    }));
  });

  it('should resolve an incident and notify up when monitor recovers', async () => {
    clientMock.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // INSERT ping_logs_raw
      .mockResolvedValueOnce({ rows: [{ consecutive_failures: 0 }] }) // UPDATE monitors
      .mockResolvedValueOnce({ rows: [{ id: 'inc-123' }] }) // SELECT open incidents FOR UPDATE
      .mockResolvedValueOnce({}) // UPDATE incidents
      .mockResolvedValueOnce({}); // COMMIT

    const processor = new PingProcessor(
      ssrfValidatorMock,
      pingClientMock,
      dbPoolMock,
      notificationQueueMock
    );

    const result = await processor.processPing({
      monitorId: 'm-1',
      teamId: 't-1',
      url: 'http://example.com',
      expectedStatus: 200,
    });

    expect(result.status).toBe('up');
    expect(clientMock.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE incidents SET resolved_at'),
      expect.any(Array)
    );
    expect(notificationQueueMock.add).toHaveBeenCalledWith('notify-up', expect.objectContaining({
      incidentId: 'inc-123',
      status: 'up',
    }));
  });

  it('should not fail the ping transaction if Redis queue add throws an error', async () => {
    clientMock.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // INSERT ping_logs_raw
      .mockResolvedValueOnce({ rows: [{ consecutive_failures: 3 }] }) // UPDATE monitors
      .mockResolvedValueOnce({}) // INSERT incidents
      .mockResolvedValueOnce({}); // COMMIT

    pingClientMock.executePing.mockResolvedValueOnce({
      responseTimeMs: 0,
      statusCode: 500,
      errorMessage: 'Internal Server Error',
    });

    notificationQueueMock.add.mockRejectedValueOnce(new Error('Redis connection lost'));

    const processor = new PingProcessor(
      ssrfValidatorMock,
      pingClientMock,
      dbPoolMock,
      notificationQueueMock
    );

    await expect(processor.processPing({
      monitorId: 'm-1',
      teamId: 't-1',
      url: 'http://example.com',
      expectedStatus: 200,
    })).resolves.toBeDefined();

    expect(clientMock.query).toHaveBeenCalledWith('COMMIT');
  });
});
