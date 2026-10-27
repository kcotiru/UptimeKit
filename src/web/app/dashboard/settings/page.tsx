import { listWebhooks } from '@/lib/server/data/webhooks';
import { listSavedViews } from '@/lib/server/data/saved-views';
import { listInvites } from '@/lib/server/data/invites';
import { Header } from '@/components/layout/header';
import { WebhookList } from '@/components/settings/webhook-list';
import { SavedViewList } from '@/components/settings/saved-view-list';
import { InviteList } from '@/components/settings/invite-list';
import { getSessionUser, supabaseServer } from '@/lib/server/supabase';
import { ADMIN_ROLES, MANAGE_ROLES, can } from '@/lib/server/actions/require-role';

// Per-user data behind a session cookie: never prerender.
export const dynamic = 'force-dynamic';

/**
 * React Server Component for team notification settings.
 */
export default async function SettingsPage() {
  let webhooks: Awaited<ReturnType<typeof listWebhooks>> = [];
  let views: Awaited<ReturnType<typeof listSavedViews>> = [];
  let invites: Awaited<ReturnType<typeof listInvites>> = [];

  // allSettled, not all: each fetch keeps its own fallback and console.error,
  // exactly as when they ran in series: one rejecting must not blank the
  // others. getSessionUser() joins the group for free: it's cache()d per
  // request, so this is its second call, not a second round trip.
  const [webhooksResult, viewsResult, invitesResult, sessionUserResult] = await Promise.allSettled([
    listWebhooks(supabaseServer()),
    listSavedViews(supabaseServer()),
    listInvites(supabaseServer()),
    getSessionUser(),
  ]);

  if (webhooksResult.status === 'fulfilled') {
    webhooks = webhooksResult.value;
  } else {
    console.error(
      'Failed to fetch webhooks:',
      webhooksResult.reason instanceof Error ? webhooksResult.reason.message : webhooksResult.reason
    );
  }

  if (viewsResult.status === 'fulfilled') {
    views = viewsResult.value;
  } else {
    console.error(
      'Failed to fetch saved views:',
      viewsResult.reason instanceof Error ? viewsResult.reason.message : viewsResult.reason
    );
  }

  if (invitesResult.status === 'fulfilled') {
    invites = invitesResult.value;
  } else {
    console.error(
      'Failed to fetch invites:',
      invitesResult.reason instanceof Error ? invitesResult.reason.message : invitesResult.reason
    );
  }

  // Webhooks and invites are admin only and the database enforces it (their
  // SELECT policies return no rows to anyone else), so non-admins do not see
  // those sections at all rather than a permanently empty list.
  const sessionUser = sessionUserResult.status === 'fulfilled' ? sessionUserResult.value : null;
  const isAdmin = can(sessionUser, ADMIN_ROLES);

  return (
    <div className="space-y-6">
      <Header
        title="Settings"
        subtitle={
          isAdmin
            ? `Alert destinations for this team (${webhooks.length} configured)`
            : 'Shared views for this team'
        }
      />

      {isAdmin && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-100">Alerts</h2>
          <WebhookList initialWebhooks={webhooks} />
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-100">Shared views</h2>
        <SavedViewList initialViews={views} canManage={can(sessionUser, MANAGE_ROLES)} />
      </div>

      {isAdmin && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-100">Team members</h2>
          <InviteList initialInvites={invites} canInvite={isAdmin} />
        </div>
      )}
    </div>
  );
}
