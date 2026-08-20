import { listWebhooks } from '@/lib/webhooks';
import { Header } from '@/components/layout/header';
import { WebhookList } from '@/components/settings/webhook-list';

// Per-user data behind a session cookie — never prerender.
export const dynamic = 'force-dynamic';

/**
 * React Server Component for team notification settings.
 */
export default async function SettingsPage() {
  let webhooks: Awaited<ReturnType<typeof listWebhooks>> = [];

  try {
    webhooks = await listWebhooks();
  } catch (error: unknown) {
    console.error('Failed to fetch webhooks:', error instanceof Error ? error.message : error);
  }

  return (
    <div className="space-y-6">
      <Header
        title="Notifications"
        subtitle={`Alert destinations for this team (${webhooks.length} configured)`}
      />
      <WebhookList initialWebhooks={webhooks} />
    </div>
  );
}
