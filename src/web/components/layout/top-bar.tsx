'use client';

import { useCallback, useRef, useState } from 'react';
import { Activity, Globe, LogOut, Palette, User } from 'lucide-react';
import { cn } from '@/lib/shared/utils';
import { supabaseBrowser } from '@/lib/client/supabase';
import { useDismissable } from '@/lib/client/use-dismissable';

export interface TopBarProps {
  /** Signed-in user's email. */
  email?: string;
  /** Signed-in user's role, shown beneath the email. */
  role?: string;
}

/** Height of the bar. The sidebar offsets itself by this, so it lives in one
 *  place rather than being repeated as a magic number in two files. */
export const TOP_BAR_HEIGHT = 'h-16';

/**
 * Application bar: the brand at the left, the account menu at the right.
 *
 * The brand keeps the same x-offset it had in the sidebar (px-2.5 around a
 * 36px mark centres it at 28px) so it stays aligned with the nav icons in the
 * rail directly below it.
 */
export function TopBar({ email, role }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, { menu: menuRef, trigger: triggerRef });

  const handleLogout = async () => {
    await supabaseBrowser().auth.signOut();
    // Hard navigation, not router.push: it drops every cached Server Component
    // payload rendered for the signed-in user.
    window.location.href = '/login';
  };

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 flex items-center justify-between',
        'border-b border-surface-border bg-surface px-2.5',
        TOP_BAR_HEIGHT
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-600/20 text-brand-400">
          <Activity className="h-5 w-5" />
        </div>
        <h1 className="font-bold leading-tight tracking-tight text-slate-50">UptimeKit</h1>
      </div>

      <div className="relative pr-1.5">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
            open
              ? 'border-surface-border bg-surface-hover text-slate-100'
              : 'border-transparent text-slate-400 hover:bg-surface-hover hover:text-slate-100'
          )}
        >
          <User className="h-5 w-5" />
        </button>

        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Account"
            className="absolute right-0 top-11 w-64 overflow-hidden rounded-lg border border-surface-border bg-surface"
          >
            <div className="border-b border-surface-border px-4 py-3">
              <p className="truncate text-sm text-slate-100" title={email}>
                {email ?? 'Signed in'}
              </p>
              {role && <p className="text-[11px] capitalize text-slate-500">{role}</p>}
            </div>

            <div className="py-1">
              {/* Placeholders, and deliberately disabled rather than dressed up
                  as working controls — a menu item that looks live and does
                  nothing is worse than one that says it isn't ready. */}
              <MenuItem icon={Palette} label="Theme" soon />
              <MenuItem icon={Globe} label="Timezone" soon />
            </div>

            <div className="border-t border-surface-border py-1">
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-2 text-sm text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

/** A menu row that is present but not yet wired up. */
function MenuItem({
  icon: Icon,
  label,
  soon,
}: {
  icon: typeof Palette;
  label: string;
  soon?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={soon}
      aria-disabled={soon}
      className="flex w-full items-center gap-3 px-4 py-2 text-sm text-slate-400 disabled:cursor-not-allowed disabled:text-slate-500"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {soon && (
        <span className="rounded-lg border border-surface-border px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
          Soon
        </span>
      )}
    </button>
  );
}
