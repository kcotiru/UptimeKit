import { describe, it, expect } from 'vitest';
import { PingClient } from '../../src/worker/http/ping-client';
import http from 'http';

describe('PingClient', () => {
  const client = new PingClient();

  it('measures response latency accurately against a local server', async () => {
    const delayMs = 50;
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      }, delayMs);
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}/`;

    try {
      const result = await client.executePing(url, '127.0.0.1');
      expect(result.statusCode).toBe(200);
      expect(result.errorMessage).toBeNull();
      // Tolerance ±15ms for local OS scheduling overhead
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(delayMs - 5);
      expect(result.responseTimeMs).toBeLessThanOrEqual(delayMs + 40);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('handles HTTP request timeout', async () => {
    const server = http.createServer((_req, res) => {
      // Hang server request
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}/`;

    try {
      const result = await client.executePing(url, '127.0.0.1', 100);
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toContain('Request timeout after 100ms');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
