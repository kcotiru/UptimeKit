import { performance } from 'perf_hooks';
import { Agent, fetch } from 'undici';

export interface PingResponse {
  responseTimeMs: number;
  statusCode: number | null;
  errorMessage: string | null;
}

export interface IPingClient {
  executePing(url: string, resolvedIp?: string, timeoutMs?: number): Promise<PingResponse>;
}

export class PingClient implements IPingClient {
  /**
   * Executes HTTP check against target URL with high-precision latency measurement
   * and custom DNS IP pinning to prevent DNS rebinding.
   */
  async executePing(url: string, resolvedIp?: string, timeoutMs: number = 30000): Promise<PingResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = performance.now();
    let dispatcher: Agent | undefined = undefined;

    try {
      if (resolvedIp) {
        dispatcher = new Agent({
          connect: {
            lookup: (
              _hostname: string,
              _options: unknown,
              callback: (err: Error | null, result: Array<{ address: string; family: number }>) => void
            ): void => {
              callback(null, [{ address: resolvedIp, family: resolvedIp.includes(':') ? 6 : 4 }]);
            },
          },
        });
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'UptimeKit-Worker/1.0',
        },
        signal: controller.signal,
        dispatcher,
      });

      const endTime = performance.now();
      const responseTimeMs = Math.round(endTime - startTime);

      return {
        responseTimeMs,
        statusCode: response.status,
        errorMessage: null,
      };
    } catch (err: unknown) {
      const error = err as Error;
      const endTime = performance.now();
      const responseTimeMs = Math.round(endTime - startTime);

      let errorMessage = error.message || 'HTTP request failed';
      if (error.name === 'AbortError' || controller.signal.aborted) {
        errorMessage = `Request timeout after ${timeoutMs}ms`;
      }

      return {
        responseTimeMs,
        statusCode: null,
        errorMessage,
      };
    } finally {
      clearTimeout(timeoutId);
      if (dispatcher) {
        await dispatcher.close().catch(() => {
          /* ignore close error */
        });
      }
    }
  }
}
