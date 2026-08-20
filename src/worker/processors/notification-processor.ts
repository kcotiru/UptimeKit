import { Pool } from 'pg';
import { request } from 'undici';
import { NotificationJobPayload } from '../queues/types';
import { SSRFValidator } from '../../shared/security/ssrf-validator';
import { buildWebhookPayload } from '../../shared/notifications/webhook-payload';

export class NotificationProcessor {
  private dbPool: Pool;
  private ssrfValidator: SSRFValidator;

  constructor(dbPool: Pool, ssrfValidator: SSRFValidator) {
    this.dbPool = dbPool;
    this.ssrfValidator = ssrfValidator;
  }

  async processNotification(jobData: NotificationJobPayload): Promise<void> {
    const { teamId, monitorId, incidentId, status, cause } = jobData;

    // 1. Fetch webhooks for the team
    const client = await this.dbPool.connect();
    let webhooks = [];
    let monitorUrl = 'Unknown URL';
    try {
      const webhookRes = await client.query(
        'SELECT provider, url FROM team_webhooks WHERE team_id = $1 AND is_deleted = false',
        [teamId]
      );
      webhooks = webhookRes.rows;

      const monitorRes = await client.query('SELECT url FROM monitors WHERE id = $1', [monitorId]);
      if (monitorRes.rows.length > 0) {
        monitorUrl = monitorRes.rows[0].url;
      }
    } finally {
      client.release();
    }

    if (webhooks.length === 0) {
      return; // No webhooks to notify
    }

    // 2. Dispatch notifications
    const promises = webhooks.map(async (wh) => {
      // The URL is user supplied, so it is re-checked here and not only where it
      // was saved: DNS can be re-pointed at an internal address after the fact.
      const ssrfResult = await this.ssrfValidator.validateUrl(wh.url);
      if (!ssrfResult.isAllowed) {
        // Skipped, not thrown: a permanently bad URL would otherwise burn all
        // five retries and block delivery to this team's healthy webhooks.
        console.error(`[Notification] Blocked ${wh.provider} webhook: ${ssrfResult.reason}`);
        return;
      }

      const payload = buildWebhookPayload(wh.provider, {
        status,
        monitorUrl,
        cause,
        monitorId,
        incidentId,
      });

      try {
        await request(wh.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.error(`[Notification] Failed to dispatch ${wh.provider} webhook:`, err);
        throw err; // Let BullMQ retry
      }
    });

    await Promise.all(promises);
  }
}
