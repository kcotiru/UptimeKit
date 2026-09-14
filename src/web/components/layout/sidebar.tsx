'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, LayoutDashboard, PlusCircle, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/shared/utils';
import { supabaseBrowser } from '@/lib/client/supabase';

/**
 * Persistent sidebar navigation bar providing branding, menu items, and logout action.
 */
export function Sidebar() {
  const pathname = usePathname();

  // Adding a monitor happens inside the Monitors section, so it nests under it
  // rather than sitting beside it as a peer destination. The parent keeps the
  // fill for the section's own pages and yields it to the child on /new, so
  // only one item ever reads as current.
  const onNewMonitor = pathname === '/dashboard/monitors/new';

  const navItems = [
    {
      name: 'Monitors',
      href: '/dashboard/monitors',
      icon: LayoutDashboard,
      active:
        (pathname === '/dashboard' || pathname.startsWith('/dashboard/monitors')) && !onNewMonitor,
      inSection: pathname === '/dashboard' || pathname.startsWith('/dashboard/monitors'),
      children: [
        {
          name: 'Add monitor',
          href: '/dashboard/monitors/new',
          icon: PlusCircle,
          active: onNewMonitor,
        },
      ],
    },
    {
      name: 'Settings',
      href: '/dashboard/settings',
      icon: Settings,
      active: pathname.startsWith('/dashboard/settings'),
      inSection: pathname.startsWith('/dashboard/settings'),
      children: [],
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
          <div className="h-9 w-9 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400">
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
              <div key={item.name} className="space-y-1">
                <Link
                  href={item.href}
                  aria-current={item.active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                    item.active
                      ? 'bg-brand-600 text-white'
                      : item.inSection
                        ? 'text-slate-100 hover:bg-surface-hover'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>

                {/* Children sit inside the section, indented and hung off a
                    guide line so the nesting is visible without a disclosure
                    control to operate. */}
                {item.children.length > 0 && (
                  <div className="ml-5 pl-3 border-l border-surface-border space-y-1">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      return (
                        <Link
                          key={child.name}
                          href={child.href}
                          aria-current={child.active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                            child.active
                              ? 'bg-brand-600 text-white'
                              : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
                          )}
                        >
                          <ChildIcon className="h-3.5 w-3.5" />
                          {child.name}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
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
