'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, LayoutDashboard, PlusCircle, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/shared/utils';
import { supabaseBrowser } from '@/lib/client/supabase';

export interface SidebarProps {
  /** Signed-in user's email, shown in the footer for orientation. */
  email?: string;
  /** Signed-in user's role, shown beneath the email. */
  role?: string;
}

/** Labels are clipped rather than removed, so they stay in the accessibility
 *  tree and a screen reader still announces the full nav item name while the
 *  rail is collapsed. `hidden` would delete them from it. */
const LABEL =
  'whitespace-nowrap opacity-0 transition-opacity duration-150 ' +
  'group-hover:opacity-100 group-focus-within:opacity-100';

/**
 * Collapsed icon rail that widens on hover, the way Supabase's dashboard nav
 * behaves.
 *
 * 192px expanded, not more: the widest row is the indented "Add monitor" child
 * at a measured 175.3px, so 192 clears it with 17px to spare. Every pixel past
 * that is empty panel laid over the page, and the panel overlays rather than
 * pushes — so width here is a direct tax on how much content is covered while
 * the rail is open.
 *
 * The <aside> keeps a constant 56px footprint while the panel inside it is
 * fixed and overlays the page when it expands — if the panel itself sat in
 * flow, every hover would reflow the whole dashboard sideways.
 *
 * Horizontal padding is tuned so an icon's centre lands at 28px, the middle of
 * the collapsed rail, and does not move when the panel widens: only the labels
 * fade in beside it.
 *
 * It also expands on `focus-within`, so tabbing through the nav reveals the
 * labels — hover alone would leave keyboard users reading unlabelled icons.
 */
export function Sidebar({ email, role }: SidebarProps) {
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
    <aside className="w-14 shrink-0">
      <div
        className={cn(
          'group fixed inset-y-0 left-0 z-30 flex h-screen w-14 flex-col justify-between',
          'overflow-hidden border-r border-surface-border bg-surface',
          // Width is the only layout property animated anywhere in here, and
          // `contain` scopes the per-frame relayout to this panel's own dozen
          // nodes so it can never reach the page. Everything else either fades
          // (opacity is compositor-only) or snaps.
          '[contain:layout_paint] transition-[width] duration-150 ease-out',
          'hover:w-48 focus-within:w-48'
        )}
      >
        <div>
          {/* Brand. The mark is 36px in a 56px rail, so px-2.5 centres it. */}
          <div className="flex h-16 items-center gap-3 border-b border-surface-border px-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-600/20 text-brand-400">
              <Activity className="h-5 w-5" />
            </div>
            <h1 className={cn('font-bold leading-tight tracking-tight text-slate-50', LABEL)}>
              UptimeKit
            </h1>
          </div>

          <nav className="space-y-1 px-2 py-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.name} className="space-y-1">
                  <Link
                    href={item.href}
                    aria-current={item.active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                      item.active
                        ? 'bg-brand-600 text-white'
                        : item.inSection
                          ? 'text-slate-100 hover:bg-surface-hover'
                          : 'text-slate-400 hover:bg-surface-hover hover:text-slate-100'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className={LABEL}>{item.name}</span>
                  </Link>

                  {/* Children hang off a guide line when the rail is open. While
                      it is collapsed the indent would push their icons past the
                      56px edge, so the offset and the line only appear on
                      expand — the border stays present but transparent so the
                      1px never shifts anything. */}
                  {item.children.length > 0 && (
                    <div
                      className={cn(
                        'space-y-1 border-l border-transparent pl-0',
                        'group-hover:ml-5 group-hover:border-surface-border group-hover:pl-3',
                        'group-focus-within:ml-5 group-focus-within:border-surface-border group-focus-within:pl-3'
                      )}
                    >
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        return (
                          <Link
                            key={child.name}
                            href={child.href}
                            aria-current={child.active ? 'page' : undefined}
                            className={cn(
                              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150',
                              child.active
                                ? 'bg-brand-600 text-white'
                                : 'text-slate-400 hover:bg-surface-hover hover:text-slate-100'
                            )}
                          >
                            <ChildIcon className="h-4 w-4 shrink-0" />
                            <span className={LABEL}>{child.name}</span>
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

        <div className="border-t border-surface-border px-2 py-4">
          {email && (
            // Collapses to zero height rather than sitting clipped, so the rail
            // has no unexplained gap above Log Out.
            <div
              className={cn(
                'max-h-0 overflow-hidden px-3',
                'group-hover:max-h-16 group-hover:pb-2',
                'group-focus-within:max-h-16 group-focus-within:pb-2'
              )}
            >
              <p className="truncate text-xs text-slate-400" title={email}>
                {email}
              </p>
              {role && <p className="text-[11px] capitalize text-slate-500">{role}</p>}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={LABEL}>Log Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
