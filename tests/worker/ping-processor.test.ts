import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PingProcessor } from '../../src/worker/processors/ping-processor';
import { PingJobPayload } from '../../src/worker/queues/types';

describe('PingProcessor', () => {
  let mockSsrfValidator: any;
  let mockPingClient: any;
  let mockDbClient: any;
  let mockDbPool: any;
  let processor: PingProcessor;

  beforeEach(() => {
    mockSsrfValidator = {
      validateUrl: vi.fn(),
    };
    mockPingClient = {
      executePing: vi.fn(),
    };
    mockDbClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ consecutive_failures: 0 }] }),
      release: vi.fn(),
    };
    mockDbPool = {
      connect: vi.fn().mockResolvedValue(mockDbClient),
    };
    processor = new PingProcessor(mockSsrfValidator as any, mockPingClient as any, mockDbPool as any, { add: vi.fn() } as any);
  });

  it('processes valid ping check, inserts log into ping_logs_raw, and sets monitor status to up', async () => {
    mockSsrfValidator.validateUrl.mockResolvedValueOnce({ isAllowed: true, resolvedIp: '93.184.216.34' });
    mockPingClient.executePing.mockResolvedValueOnce({
      responseTimeMs: 120,
      statusCode: 200,
      errorMessage: null,
    });

    const jobData: PingJobPayload = {
      monitorId: 'm1',
      teamId: 't1',
      url: 'https://example.com',
      expectedStatus: 200,
      checkInterval: 30,
    };

    const result = await processor.processPing(jobData);

    expect(result.status).toBe('up');
    expect(result.responseTimeMs).toBe(120);
    expect(result.statusCode).toBe(200);
    expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('sets monitor status to degraded when response time exceeds 5000ms threshold', async () => {
    mockSsrfValidator.validateUrl.mockResolvedValueOnce({ isAllowed: true, resolvedIp: '93.184.216.34' });
    mockPingClient.executePing.mockResolvedValueOnce({
      responseTimeMs: 5500,
      statusCode: 200,
      errorMessage: null,
    });

    const jobData: PingJobPayload = {
      monitorId: 'm1',
      teamId: 't1',
      url: 'https://example.com',
      expectedStatus: 200,
      checkInterval: 30,
    };

    const result = await processor.processPing(jobData);
    expect(result.status).toBe('degraded');
  });

  it('immediately sets monitor status to down on 1st failed attempt or status mismatch', async () => {
    mockSsrfValidator.validateUrl.mockResolvedValueOnce({ isAllowed: true, resolvedIp: '93.184.216.34' });
    mockPingClient.executePing.mockResolvedValueOnce({
      responseTimeMs: 200,
      statusCode: 500,
      errorMessage: null,
    });

    const jobData: PingJobPayload = {
      monitorId: 'm1',
      teamId: 't1',
      url: 'https://example.com',
      expectedStatus: 200,
      checkInterval: 30,
    };

    const result = await processor.processPing(jobData);
    expect(result.status).toBe('down');
    expect(result.errorMessage).toContain('Unexpected status code: 500');
  });

  it('blocks SSRF violation and sets status to down without executing HTTP request', async () => {
    mockSsrfValidator.validateUrl.mockResolvedValueOnce({
      isAllowed: false,
      reason: 'SSRF Violation: IP 127.0.0.1 is in restricted range',
    });

    const jobData: PingJobPayload = {
      monitorId: 'm1',
      teamId: 't1',
      url: 'http://127.0.0.1',
      expectedStatus: 200,
      checkInterval: 30,
    };

    const result = await processor.processPing(jobData);
    expect(result.status).toBe('down');
    expect(result.errorMessage).toContain('SSRF Violation');
    expect(mockPingClient.executePing).not.toHaveBeenCalled();
  });
});
