import { NextResponse } from 'next/server';
import { getWebhook } from '@/lib/webhooks';
import { buildWebhookPayload } from '@shared/notifications/webhook-payload';
import { SSRFValidator } from '@shared/security/ssrf-validator';

// Needs node dns/net, so it cannot run on the edge runtime.
export const runtime = 'nodejs';

const ssrfValidator = new SSRFValidator();

/**
 * Sends a sample notification to one webhook so a user can confirm the
 * destination works without waiting for a real outage.
 *
 * The URL is re-validated here rather than trusted from the saved row: this
 * route posts a request from the server, so it is an SSRF sink in its own right.
 * @param _request - Incoming request object
 * @param params - URL parameters object containing target webhook ID
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const webhook = await getWebhook(params.id);
    if (!webhook) {
      return NextResponse.json({ success: false, error: 'Webhook not found' }, { status: 404 });
    }

    const ssrfResult = await ssrfValidator.validateUrl(webhook.url);
    if (!ssrfResult.isAllowed) {
      return NextResponse.json(
        { success: false, error: ssrfResult.reason || 'URL is not a permitted destination' },
        { status: 400 }
      );
    }

    const payload = buildWebhookPayload(webhook.provider, {
      status: 'up',
      monitorUrl: 'https://example.com (test)',
      cause: 'Test notification from UptimeKit',
      monitorId: 'test',
      incidentId: 'test',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      return NextResponse.json({
        success: res.ok,
        data: { statusCode: res.status },
        ...(res.ok ? {} : { error: `Destination responded ${res.status}` }),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
