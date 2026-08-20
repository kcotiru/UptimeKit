'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Link2, Plus } from 'lucide-react';
import { createWebhookSchema, CreateWebhookSchema } from '@/lib/validations/webhook';

const PROVIDERS: { value: CreateWebhookSchema['provider']; label: string; hint: string }[] = [
  { value: 'slack', label: 'Slack', hint: 'Incoming webhook URL from your Slack app' },
  { value: 'discord', label: 'Discord', hint: 'Channel → Integrations → Webhooks' },
  { value: 'generic', label: 'Generic JSON', hint: 'Any endpoint accepting a JSON POST' },
];

/**
 * Client form for adding a team notification webhook, with the same
 * zero-network validation the monitor form uses.
 */
export function WebhookForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [provider, setProvider] = useState<CreateWebhookSchema['provider']>('slack');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeHint = PROVIDERS.find((p) => p.value === provider)?.hint;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const result = createWebhookSchema.safeParse({ provider, url });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Invalid webhook');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.data),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Failed to add webhook');
        return;
      }

      setUrl('');
      onCreated?.();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error while adding webhook');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface border border-surface-border rounded-2xl p-6 shadow-xl space-y-4"
    >
      <div>
        <h3 className="text-base font-bold text-slate-100">Add a webhook</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          UptimeKit posts here when a monitor goes down and again when it recovers.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="provider" className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
          Provider
        </label>
        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              type="button"
              key={p.value}
              onClick={() => setProvider(p.value)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                provider === p.value
                  ? 'bg-brand-600 text-white border-brand-500'
                  : 'bg-surface-hover text-slate-300 border-surface-border hover:text-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="url" className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
          Destination URL
        </label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            id="url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full pl-9 pr-3 py-2.5 bg-background border border-surface-border rounded-lg text-sm text-slate-100 font-mono placeholder:text-slate-600 focus:outline-none focus:border-brand-500"
          />
        </div>
        <p className="text-[11px] text-slate-500">{activeHint}</p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        <Plus className="h-4 w-4" />
        {submitting ? 'Adding…' : 'Add webhook'}
      </button>
    </form>
  );
}
