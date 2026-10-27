import { Header } from '@/components/layout/header';
import { CreateMonitorForm } from '@/components/monitors/create-monitor-form';
import { getSessionUser } from '@/lib/server/supabase';
import { MANAGE_ROLES, requireRole } from '@/lib/server/actions/require-role';

// Per-user role behind a session cookie, never prerender.
export const dynamic = 'force-dynamic';

export default async function NewMonitorPage() {
  // A hidden link stops nobody navigating here, so the page itself says no.
  // createMonitorAction is still the real guard.
  const denied = requireRole(await getSessionUser(), MANAGE_ROLES);
  if (denied) {
    return (
      <div className="space-y-6">
        <Header title="Add a monitor" />
        <p className="text-sm text-slate-400">{denied}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header title="Add a monitor" />
      <CreateMonitorForm />
    </div>
  );
}
