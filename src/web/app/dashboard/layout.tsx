import { cookies } from 'next/headers';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { getSessionClaims, getSessionUser } from '@/lib/server/supabase';
import { MANAGE_ROLES, can } from '@/lib/server/actions/require-role';
import { SIDEBAR_MODE_COOKIE, parseSidebarMode } from '@/lib/shared/sidebar-mode';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionClaims();
  // cache()d per request, so the pages' own calls reuse this one. Fails closed.
  const canManage = can(await getSessionUser().catch(() => null), MANAGE_ROLES);
  // Read on the server so the rail paints at its chosen width immediately,
  // rather than flashing the default and then correcting after mount.
  const mode = parseSidebarMode(cookies().get(SIDEBAR_MODE_COOKIE)?.value);

  return (
    <div className="min-h-screen bg-background text-slate-100">
      <TopBar email={user?.email} />

      {/* pt-16 clears the fixed bar. The bar and the rail are both fixed, so
          nothing below them reflows when the rail expands on hover. */}
      <div className="flex pt-16">
        <Sidebar initialMode={mode} canManage={canManage} />
        <main className="min-w-0 flex-1 p-8">
          {/* Cap line length so a monitor row's name and timestamp stay readably close on wide displays. */}
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
