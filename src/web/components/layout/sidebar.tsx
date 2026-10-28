'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  MousePointer,
  PlusCircle,
  Settings,
  Sidebar as SidebarIcon,
} from 'lucide-react';
import { cn } from '@/lib/shared/utils';
import { useDismissable } from '@/lib/client/use-dismissable';
import { SIDEBAR_MODE_COOKIE, type SidebarMode } from '@/lib/shared/sidebar-mode';

export interface SidebarProps {
  /** Mode read from the cookie on the server, so the first paint is correct. */
  initialMode: SidebarMode;
  /** Whether the viewer may add monitors; read-only viewers get no Add monitor link. */
  canManage: boolean;
}

const MODES: { id: SidebarMode; label: string; icon: typeof MousePointer; hint: string }[] = [
  { id: 'hover', label: 'Expand on hover', icon: MousePointer, hint: 'Opens while pointing at it' },
  { id: 'expanded', label: 'Always expanded', icon: ChevronsRight, hint: 'Pinned open beside the page' },
  { id: 'collapsed', label: 'Always collapsed', icon: ChevronsLeft, hint: 'Icons only, never widens' },
];

/**
 * Nav rail with three widths, chosen by the control at its foot.
 *
 * - `hover` (default) stays 56px and widens to 192px while pointed at. The
 *   panel is fixed, so it overlays rather than reflowing the page.
 * - `expanded` is pinned at 192px and the <aside> reserves that width, so
 *   content sits beside the rail instead of underneath it. A permanently
 *   open rail that covered content would be unusable.
 * - `collapsed` is pinned at 56px and never widens, on hover or on focus. The
 *   icons still navigate; only the labels are withheld.
 *
 * The choice rides in a cookie the server reads, so the first paint is already
 * the chosen width (see lib/shared/sidebar-mode.ts for why not localStorage).
 *
 * Labels are clipped rather than removed, so they stay in the accessibility
 * tree and a screen reader still announces each item while the rail is narrow.
 */
export function Sidebar({ initialMode, canManage }: SidebarProps) {
  const pathname = usePathname();
  const [mode, setMode] = useState<SidebarMode>(initialMode);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, { menu: menuRef, trigger: triggerRef });

  const choose = (next: SidebarMode) => {
    setMode(next);
    setOpen(false);
    // A year, path-wide, Lax: a nav preference is not worth a round trip to
    // store, and the server must be able to read it on the next request.
    document.cookie = `${SIDEBAR_MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };

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
      children: canManage
        ? [
            {
              name: 'Add monitor',
              href: '/dashboard/monitors/new',
              icon: PlusCircle,
              active: onNewMonitor,
            },
          ]
        : [],
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

  // Tailwind only emits classes it can see spelled out, so these are literal
  // strings per mode rather than anything interpolated.
  const panelWidth =
    mode === 'expanded'
      ? 'w-48'
      : mode === 'collapsed'
        ? 'w-14'
        : 'w-14 hover:w-48 focus-within:w-48';

  const label =
    mode === 'expanded'
      ? 'whitespace-nowrap opacity-100'
      : mode === 'collapsed'
        ? 'whitespace-nowrap opacity-0'
        : 'whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100';

  // Only a rail that can never widen needs its icons named on hover.
  const tooltips = mode === 'collapsed';

  const indent =
    mode === 'expanded'
      ? 'ml-5 border-l border-surface-border pl-3'
      : mode === 'collapsed'
        ? 'border-l border-transparent pl-0'
        : 'border-l border-transparent pl-0 group-hover:ml-5 group-hover:border-surface-border group-hover:pl-3 group-focus-within:ml-5 group-focus-within:border-surface-border group-focus-within:pl-3';

  return (
    // Only the pinned-open rail occupies layout space; the other two overlay.
    <aside className={cn('shrink-0', mode === 'expanded' ? 'w-48' : 'w-14')}>
      <div
        className={cn(
          'group fixed bottom-0 left-0 top-16 z-30 flex flex-col justify-between',
          'border-r border-surface-border bg-surface',
          // Clipping and containment exist only to scope the width animation's
          // per-frame relayout. Pinned shut there is no animation to scope, and
          // both would cut off the hover tooltips: `contain: paint` clips even
          // position:fixed descendants, so neither applies in that mode.
          mode === 'collapsed'
            ? ''
            : 'overflow-hidden [contain:layout_paint] transition-[width] duration-150 ease-out',
          panelWidth
        )}
      >
        <nav className="space-y-1 px-2 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.name} className="space-y-1">
                <Link
                  href={item.href}
                  aria-current={item.active ? 'page' : undefined}
                  className={cn(
                    'group/item relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                    item.active
                      ? 'bg-brand-600 text-white'
                      : item.inSection
                        ? 'text-slate-100 hover:bg-surface-hover'
                        : 'text-slate-400 hover:bg-surface-hover hover:text-slate-100'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className={label}>{item.name}</span>
                  {tooltips && <Tooltip>{item.name}</Tooltip>}
                </Link>

                {item.children.length > 0 && (
                  <div className={cn('space-y-1', indent)}>
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      return (
                        <Link
                          key={child.name}
                          href={child.href}
                          aria-current={child.active ? 'page' : undefined}
                          className={cn(
                            'group/item relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150',
                            child.active
                              ? 'bg-brand-600 text-white'
                              : 'text-slate-400 hover:bg-surface-hover hover:text-slate-100'
                          )}
                        >
                          <ChildIcon className="h-4 w-4 shrink-0" />
                          <span className={label}>{child.name}</span>
                          {tooltips && <Tooltip>{child.name}</Tooltip>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="relative border-t border-surface-border px-2 py-4">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Sidebar behaviour"
            className={cn(
              'group/item relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              open
                ? 'bg-surface-hover text-slate-100'
                : 'text-slate-400 hover:bg-surface-hover hover:text-slate-100'
            )}
          >
            <SidebarIcon className="h-4 w-4 shrink-0" />
            <span className={label}>Sidebar</span>
            {tooltips && !open && <Tooltip>Sidebar</Tooltip>}
          </button>

        </div>
      </div>

      {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Sidebar behaviour"
            // Opens beside the rail, not inside it: at 56px there is nowhere
            // for a readable menu to go, and the panel clips its overflow.
            // Rendered outside the panel on purpose: the panel sets
            // `contain: layout paint` in the animating modes, which makes it
            // the containing block for fixed descendants AND clips them, so a
            // menu nested inside it is cut off exactly when the rail is wide.
            // Sits directly above its trigger rather than beside the rail. The
            // button spans 16–56px from the viewport foot (py-4 footer padding
            // plus a 40px button), so bottom-16 clears it by 8px, and left-2
            // lines the menu up with the rail's own px-2 gutter. Both are fixed
            // offsets, so the menu does not move when the rail changes width.
            className="fixed bottom-16 left-2 z-40 w-56 overflow-hidden rounded-lg border border-surface-border bg-surface py-1"
          >
            {MODES.map(({ id, label: name, icon: Icon, hint }) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={mode === id}
                onClick={() => choose(id)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-2 text-left transition-colors',
                  mode === id
                    ? 'bg-surface-hover text-slate-100'
                    : 'text-slate-400 hover:bg-surface-hover hover:text-slate-100'
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm">{name}</span>
                  <span className="block text-[11px] text-slate-500">{hint}</span>
                </span>
              </button>
            ))}
          </div>
      )}
    </aside>
  );
}

/**
 * Floating name for a rail icon, used only while the rail is pinned shut.
 *
 * aria-hidden: the link already carries its label as text, clipped but present
 * in the accessibility tree, so announcing this too would say everything twice.
 */
function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2',
        'whitespace-nowrap rounded-lg border border-surface-border bg-surface',
        'px-2 py-1 text-xs font-medium text-slate-100',
        'opacity-0 transition-opacity duration-100',
        'group-hover/item:opacity-100 group-focus-visible/item:opacity-100'
      )}
    >
      {children}
    </span>
  );
}
