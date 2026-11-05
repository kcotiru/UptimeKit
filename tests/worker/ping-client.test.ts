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
      // Tolerance ±15ms for local OS scheduling overhead, but allow up to +100ms for CI/test environments
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(delayMs - 5);
      expect(result.responseTimeMs).toBeLessThanOrEqual(delayMs + 500);
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

  describe('redirected flag', () => {
    async function withServer(
      handler: http.RequestListener,
      run: (port: number) => Promise<void>
    ): Promise<void> {
      const server = http.createServer(handler);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        await run((server.address() as any).port);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }

    it('reports redirected when a hop was followed, with the final status', async () => {
      await withServer(
        (req, res) => {
          if (req.url === '/start') {
            res.writeHead(302, { Location: '/end' });
            res.end();
          } else {
            res.writeHead(200);
            res.end('OK');
          }
        },
        async port => {
          const result = await client.executePing(`http://127.0.0.1:${port}/start`, '127.0.0.1');
          expect(result.statusCode).toBe(200);
          expect(result.redirected).toBe(true);
          expect(result.errorMessage).toBeNull();
        }
      );
    });

    it('reports not redirected for a direct answer', async () => {
      await withServer(
        (_req, res) => {
          res.writeHead(200);
          res.end('OK');
        },
        async port => {
          const result = await client.executePing(`http://127.0.0.1:${port}/`, '127.0.0.1');
          expect(result.statusCode).toBe(200);
          expect(result.redirected).toBe(false);
        }
      );
    });

    it('reports not redirected when a 3xx carries no Location', async () => {
      await withServer(
        (_req, res) => {
          res.writeHead(301);
          res.end();
        },
        async port => {
          const result = await client.executePing(`http://127.0.0.1:${port}/`, '127.0.0.1');
          expect(result.statusCode).toBe(301);
          expect(result.redirected).toBe(false);
        }
      );
    });

    it('reports not redirected on a timeout', async () => {
      await withServer(
        () => {
          // Hang server request
        },
        async port => {
          const result = await client.executePing(`http://127.0.0.1:${port}/`, '127.0.0.1', 100);
          expect(result.statusCode).toBeNull();
          expect(result.redirected).toBe(false);
        }
      );
    });
  });
});
