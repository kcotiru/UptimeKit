'use client';

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { createSavedViewAction } from '@/lib/server/actions/saved-views';

/**
 * Saves the currently displayed window and hands back a public link.
 * The window is captured at click time and pinned — the whole point is that
 * the link keeps showing this window, not "the last four hours" forever.
 */
export function SaveViewButton({
  monitorId,
  from,
  to,
}: {
  monitorId: string;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const outcome = await createSavedViewAction({ monitorId, name, from, to });
    setSaving(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setShareUrl(`${window.location.origin}/share/${outcome.data.shareToken}`);
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-surface-border text-slate-300 text-xs font-semibold rounded-lg transition-colors"
      >
        <Share2 className="h-3.5 w-3.5" /> Share this window
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 bg-surface border border-surface-border rounded-xl p-4 shadow-2xl space-y-3">
          {shareUrl ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-200">Anyone with this link can view it</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 min-w-0 px-2.5 py-1.5 bg-background border border-surface-border rounded-lg text-[11px] text-slate-300 font-mono"
                />
                <button
                  onClick={handleCopy}
                  aria-label="Copy share link"
                  className="p-2 text-slate-400 hover:text-brand-400 rounded-lg"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Revoke it any time from Notifications &rarr; Shared views.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-3">
              <label className="block text-[11px] font-medium text-slate-400">
                Name this window
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Feb 14 checkout outage"
                  className="mt-1 w-full px-2.5 py-1.5 bg-background border border-surface-border rounded-lg text-xs text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </label>
              {error && <p className="text-[11px] text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create share link'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
