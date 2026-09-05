import { listWebhooks } from '@/lib/server/data/webhooks';
import { listSavedViews } from '@/lib/server/data/saved-views';
import { listInvites } from '@/lib/server/data/invites';
import { Header } from '@/components/layout/header';
import { WebhookList } from '@/components/settings/webhook-list';
import { SavedViewList } from '@/components/settings/saved-view-list';
import { InviteList } from '@/components/settings/invite-list';
import { getSessionUser, supabaseServer } from '@/lib/server/supabase';

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

  let views: Awaited<ReturnType<typeof listSavedViews>> = [];
  try {
    views = await listSavedViews(supabaseServer());
  } catch (error: unknown) {
    console.error('Failed to fetch saved views:', error instanceof Error ? error.message : error);
  }

  let invites: Awaited<ReturnType<typeof listInvites>> = [];
  try {
    invites = await listInvites(supabaseServer());
  } catch (error: unknown) {
    console.error('Failed to fetch invites:', error instanceof Error ? error.message : error);
  }

  // Hides the create form for non-admins. Cosmetic only — createInviteAction
  // re-checks the role, because a hidden button stops nobody.
  const canInvite = (await getSessionUser())?.role === 'admin';

  return (
    <div className="space-y-6">
      <Header
        title="Notifications"
        subtitle={`Alert destinations for this team (${webhooks.length} configured)`}
      />
      <WebhookList initialWebhooks={webhooks} />

      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-100">Shared views</h2>
        <SavedViewList initialViews={views} />
      </div>

      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-100">Team members</h2>
        <InviteList initialInvites={invites} canInvite={canInvite} />
      </div>
    </div>
  );
}
