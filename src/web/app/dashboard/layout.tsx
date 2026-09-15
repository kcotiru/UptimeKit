import { Sidebar } from '@/components/layout/sidebar';
import { getSessionUser } from '@/lib/server/supabase';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen bg-background text-slate-100">
      <Sidebar email={user?.email} role={user?.role} />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-8 overflow-y-auto">
          {/* Cap line length so a monitor row's name and timestamp stay readably close on wide displays. */}
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
