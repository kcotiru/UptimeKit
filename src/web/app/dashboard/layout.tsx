import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { getSessionUser } from '@/lib/server/supabase';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();

  return (
    <div className="min-h-screen bg-background text-slate-100">
      <TopBar email={user?.email} role={user?.role} />

      {/* pt-16 clears the fixed bar. The bar and the rail are both fixed, so
          nothing below them reflows when the rail expands on hover. */}
      <div className="flex pt-16">
        <Sidebar />
        <main className="min-w-0 flex-1 p-8">
          {/* Cap line length so a monitor row's name and timestamp stay readably close on wide displays. */}
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
