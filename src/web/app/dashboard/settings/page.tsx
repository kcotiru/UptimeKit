import { listWebhooks } from '@/lib/server/data/webhooks';
import { Header } from '@/components/layout/header';
import { WebhookList } from '@/components/settings/webhook-list';
import { supabaseServer } from '@/lib/server/supabase';

// Per-user data behind a session cookie — never prerender.
export const dynamic = 'force-dynamic';

/**
 * React Server Component for team notification settings.
 */
export default async function SettingsPage() {
  let webhooks: Awaited<ReturnType<typeof listWebhooks>> = [];

  try {
    webhooks = await listWebhooks(supabaseServer());
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
