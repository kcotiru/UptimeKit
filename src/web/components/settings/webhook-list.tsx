'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellOff, Check, Send, Trash2, X } from 'lucide-react';
import { TeamWebhook } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { WebhookForm } from './webhook-form';

const PROVIDER_LABEL: Record<TeamWebhook['provider'], string> = {
  slack: 'Slack',
  discord: 'Discord',
  generic: 'Generic JSON',
};

/**
 * Lists a team's notification webhooks with test-send and delete actions.
 */
export function WebhookList({ initialWebhooks }: { initialWebhooks: TeamWebhook[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const handleTest = async (webhook: TeamWebhook) => {
    setBusyId(webhook.id);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/webhooks/${webhook.id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setResult({
        id: webhook.id,
        ok: Boolean(data.success),
        message: data.success
          ? `Delivered (${data.data?.statusCode})`
          : data.error || 'Delivery failed',
      });
    } catch (err: unknown) {
      setResult({
        id: webhook.id,
        ok: false,
        message: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (webhook: TeamWebhook) => {
    setBusyId(webhook.id);
    try {
      const res = await fetch(`/api/v1/webhooks/${webhook.id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <WebhookForm />

      {initialWebhooks.length === 0 ? (
        <div className="bg-surface border border-surface-border border-dashed rounded-2xl p-10 text-center space-y-2">
          <BellOff className="h-8 w-8 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-300">No webhooks configured</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Without one, UptimeKit records incidents but has nowhere to send them. Add a destination
            above to start receiving alerts.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-surface-border rounded-2xl divide-y divide-surface-border overflow-hidden">
          {initialWebhooks.map((webhook) => (
            <div key={webhook.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-brand-600/15 border border-brand-500/30 text-brand-400 text-[11px] font-semibold">
                    {PROVIDER_LABEL[webhook.provider]}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Added {formatDate(webhook.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-mono truncate">{webhook.url}</p>
                {result?.id === webhook.id && (
                  <p
                    className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                      result.ok ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {result.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {result.message}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleTest(webhook)}
                  disabled={busyId === webhook.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover hover:bg-brand-600/20 border border-surface-border text-slate-300 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {busyId === webhook.id ? 'Sending…' : 'Test'}
                </button>
                <button
                  onClick={() => handleDelete(webhook)}
                  disabled={busyId === webhook.id}
                  aria-label="Delete webhook"
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
