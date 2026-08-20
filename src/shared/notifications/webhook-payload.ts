export type WebhookProvider = 'slack' | 'discord' | 'generic';

export interface WebhookPayloadInput {
  status: 'down' | 'up';
  monitorUrl: string;
  cause: string;
  monitorId: string;
  incidentId: string;
}

/**
 * Builds the body posted to a team webhook. Shared so the dashboard's
 * "send test" button delivers byte-identical output to a real incident —
 * a test that formats differently from production is not a test.
 */
export function buildWebhookPayload(
  provider: WebhookProvider | string,
  { status, monitorUrl, cause, monitorId, incidentId }: WebhookPayloadInput
): Record<string, unknown> {
  const message =
    status === 'down'
      ? `🚨 Monitor Down: ${monitorUrl}\nCause: ${cause}`
      : `✅ Monitor Recovered: ${monitorUrl}`;

  if (provider === 'slack') return { text: message };
  if (provider === 'discord') return { content: message };

  return {
    event: status === 'down' ? 'monitor.down' : 'monitor.up',
    monitorId,
    incidentId,
    url: monitorUrl,
    cause,
  };
}
