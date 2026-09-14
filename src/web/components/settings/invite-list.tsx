'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, ChevronDown, Copy, Link2Off, UserPlus } from 'lucide-react';
import type { TeamInvite } from '@/lib/shared/types';
import { formatDate } from '@/lib/shared/utils';
import { createInviteAction, revokeInviteAction } from '@/lib/server/actions/invites';

const ROLES = [
  { value: 'member', label: 'Member — can manage monitors' },
  { value: 'viewer', label: 'Viewer — read only' },
  { value: 'admin', label: 'Admin — full access, can invite' },
];

function isLive(invite: TeamInvite): boolean {
  return !invite.revokedAt && new Date(invite.expiresAt) > new Date();
}

/** Lists a team's invite links with create, copy, and revoke. */
export function InviteList({
  initialInvites,
  canInvite,
}: {
  initialInvites: TeamInvite[];
  canInvite: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [role, setRole] = useState('member');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCopy = async (invite: TeamInvite) => {
    await navigator.clipboard.writeText(`${window.location.origin}/register?invite=${invite.token}`);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const outcome = await createInviteAction({ role, expiresInDays });
      if (outcome.ok) router.refresh();
      else setError(outcome.error);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setBusyId(id);
    try {
      const outcome = await revokeInviteAction(id);
      if (outcome.ok) router.refresh();
      else setError(outcome.error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {canInvite && (
        <div className="bg-surface border border-surface-border rounded-lg p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label
              htmlFor="invite-role"
              className="block text-xs font-semibold text-slate-300 mb-2"
            >
              Role
            </label>
            {/* appearance-none, then our own chevron. Chromium paints a native
                select's arrow at the border-box edge and ignores padding-right,
                so the arrow is only positionable once the native one is off.
                Same icon-inside-a-control pattern as webhook-form's URL field. */}
            <div className="relative">
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>
          </div>

          <div className="w-32">
            <label
              htmlFor="invite-expiry"
              className="block text-xs font-semibold text-slate-300 mb-2"
            >
              Expires
            </label>
            <div className="relative">
              <select
                id="invite-expiry"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
                className="w-full appearance-none pl-3 pr-8 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
              >
                {[1, 7, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} {d === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2.5 bg-surface hover:bg-surface-hover border border-surface-border text-slate-100 disabled:opacity-50 text-sm font-semibold rounded-lg inline-flex items-center gap-2 transition-all"
          >
            <UserPlus className="h-4 w-4" />
            {creating ? 'Creating…' : 'Create invite'}
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {initialInvites.length === 0 ? (
        <div className="bg-surface border border-surface-border border-dashed rounded-lg p-10 text-center space-y-2">
          <UserPlus className="h-8 w-8 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-300">No invite links</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {canInvite
              ? 'Create a link above and send it to whoever should join. Anyone holding the link can register into this team, so share it like a password.'
              : 'Only team admins can invite new members.'}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-surface-border rounded-lg divide-y divide-surface-border overflow-hidden">
          {initialInvites.map((invite) => (
            <div key={invite.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-200 capitalize">
                    {invite.role}
                  </span>
                  {invite.revokedAt ? (
                    <span className="px-2 py-0.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-[11px] font-semibold">
                      Revoked
                    </span>
                  ) : (
                    !isLive(invite) && (
                      <span className="px-2 py-0.5 rounded-lg bg-slate-500/15 border border-slate-500/30 text-slate-400 text-[11px] font-semibold">
                        Expired
                      </span>
                    )
                  )}
                </div>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  Expires {formatDate(invite.expiresAt)}
                </p>
              </div>

              {isLive(invite) && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleCopy(invite)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover hover:bg-brand-600/20 border border-surface-border text-slate-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    {copiedId === invite.id ? (
                      <Check className="h-3.5 w-3.5 text-brand-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedId === invite.id ? 'Copied' : 'Copy link'}
                  </button>
                  {canInvite && (
                    <button
                      onClick={() => handleRevoke(invite.id)}
                      disabled={busyId === invite.id}
                      aria-label="Revoke invite link"
                      className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Link2Off className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
