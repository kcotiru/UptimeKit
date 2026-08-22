'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Link2Off, Share2, Trash2 } from 'lucide-react';
import type { SavedView } from '@/lib/shared/types';
import { formatDate } from '@/lib/shared/utils';
import { deleteSavedViewAction, revokeSavedViewAction } from '@/lib/server/actions/saved-views';

/** Lists a team's shared windows with copy, revoke, and delete. */
export function SavedViewList({ initialViews }: { initialViews: SavedView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (view: SavedView) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${view.shareToken}`);
    setCopiedId(view.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const run = async (id: string, fn: () => Promise<{ ok: boolean }>) => {
    setBusyId(id);
    try {
      const outcome = await fn();
      if (outcome.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (initialViews.length === 0) {
    return (
      <div className="bg-surface border border-surface-border border-dashed rounded-2xl p-10 text-center space-y-2">
        <Share2 className="h-8 w-8 text-slate-600 mx-auto" />
        <p className="text-sm font-semibold text-slate-300">No shared views</p>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Open a monitor, pick a time window, and choose “Share this window” to create a public
          link.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-surface-border rounded-2xl divide-y divide-surface-border overflow-hidden">
      {initialViews.map((view) => (
        <div key={view.id} className="p-4 flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200 truncate">{view.name}</span>
              {view.revokedAt && (
                <span className="px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-[11px] font-semibold">
                  Revoked
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 font-mono">
              {formatDate(view.from)} — {formatDate(view.to)}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!view.revokedAt && (
              <>
                <button
                  onClick={() => handleCopy(view)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover hover:bg-brand-600/20 border border-surface-border text-slate-300 text-xs font-semibold rounded-lg transition-colors"
                >
                  {copiedId === view.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === view.id ? 'Copied' : 'Copy link'}
                </button>
                <button
                  onClick={() => run(view.id, () => revokeSavedViewAction(view.id))}
                  disabled={busyId === view.id}
                  aria-label="Revoke share link"
                  className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Link2Off className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={() => run(view.id, () => deleteSavedViewAction(view.id))}
              disabled={busyId === view.id}
              aria-label="Delete saved view"
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
