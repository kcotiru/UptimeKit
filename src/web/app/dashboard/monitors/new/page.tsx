import { Header } from '@/components/layout/header';
import { CreateMonitorForm } from '@/components/monitors/create-monitor-form';
import { getSessionUser } from '@/lib/server/supabase';
import { MANAGE_ROLES, requireRole } from '@/lib/server/actions/require-role';

// Per-user role behind a session cookie, never prerender.
export const dynamic = 'force-dynamic';

export default async function NewMonitorPage() {
  // A hidden link stops nobody navigating here, so the page itself says no.
  // createMonitorAction is still the real guard.
  // A failed profile lookup reads as signed out, so it shows the refusal rather
  // than the error boundary (same as app/dashboard/layout.tsx).
  const denied = requireRole(await getSessionUser().catch(() => null), MANAGE_ROLES);
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
