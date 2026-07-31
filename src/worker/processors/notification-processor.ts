import { Pool } from 'pg';
import { request } from 'undici';
import { NotificationJobPayload } from '../queues/types';

export class NotificationProcessor {
  private dbPool: Pool;

  constructor(dbPool: Pool) {
    this.dbPool = dbPool;
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
      let payload = {};
      const message = status === 'down' 
        ? `🚨 Monitor Down: ${monitorUrl}\nCause: ${cause}`
        : `✅ Monitor Recovered: ${monitorUrl}`;

      if (wh.provider === 'slack') {
        payload = { text: message };
      } else if (wh.provider === 'discord') {
        payload = { content: message };
      } else {
        payload = {
          event: status === 'down' ? 'monitor.down' : 'monitor.up',
          monitorId,
          incidentId,
          url: monitorUrl,
          cause
        };
      }

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
