'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, LayoutDashboard, PlusCircle, Bell, LogOut } from 'lucide-react';
import { cn } from '@/lib/shared/utils';
import { supabaseBrowser } from '@/lib/client/supabase';

/**
 * Persistent sidebar navigation bar providing branding, menu items, and logout action.
 */
export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    {
      name: 'Monitors',
      href: '/dashboard/monitors',
      icon: LayoutDashboard,
      active: pathname === '/dashboard' || pathname.startsWith('/dashboard/monitors'),
    },
    {
      name: 'New Monitor',
      href: '/dashboard/monitors/new',
      icon: PlusCircle,
      active: pathname === '/dashboard/monitors/new',
    },
    {
      name: 'Settings',
      href: '/dashboard/settings',
      icon: Bell,
      active: pathname.startsWith('/dashboard/settings'),
    },
  ];

  const handleLogout = async () => {
    await supabaseBrowser().auth.signOut();
    // Hard navigation, not router.push: it drops every cached Server Component
    // payload rendered for the signed-in user.
    window.location.href = '/login';
  };

  return (
    <aside className="w-64 border-r border-surface-border bg-surface flex flex-col justify-between h-screen sticky top-0">
      <div>
        {/* Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-surface-border gap-3">
          <div className="h-9 w-9 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-500">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-slate-50 tracking-tight leading-tight">UptimeKit</h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  item.active
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer / Logout */}
      <div className="p-4 border-t border-surface-border">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
