'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createMonitorSchema, CreateMonitorSchema } from '@/lib/shared/validations/monitor';
import { createMonitorAction } from '@/lib/server/actions/monitors';
import { Activity, Globe, Clock, ShieldAlert, AlertCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * Client form component for creating a new HTTP health monitor with instant zero-network validation.
 */
export function CreateMonitorForm() {
  const router = useRouter();

  const [formData, setFormData] = useState<CreateMonitorSchema>({
    name: '',
    url: '',
    intervalSeconds: 60,
    timeoutMs: 5000,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setServerError('');

    // Instant Zero-Network Client Validation (SC-002)
    const result = createMonitorSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) {
          fieldErrors[issue.path[0].toString()] = issue.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);

    try {
      const outcome = await createMonitorAction(result.data);

      if (!outcome.ok) {
        setServerError(outcome.error);
        setSubmitting(false);
        return;
      }

      router.push('/dashboard/monitors');
      router.refresh();
    } catch (error: unknown) {
      console.error('Error submitting create monitor form:', error instanceof Error ? error.message : error);
      setServerError('Could not save that monitor. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/monitors"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> All monitors
        </Link>
      </div>

      <div className="bg-surface border border-surface-border rounded-lg p-8 space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-50 tracking-tight">Add a monitor</h2>
          <p className="text-xs text-slate-400">UptimeKit will request this URL on a schedule and record how long it takes.</p>
        </div>

        {serverError && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Name
            </label>
            <div className="relative">
              <Activity className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Production API Endpoint"
                className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
              />
            </div>
            {errors.name && <p className="mt-1.5 text-xs font-medium text-red-400">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              URL
            </label>
            <div className="relative">
              <Globe className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://api.acme.com/health"
                className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
              />
            </div>
            {errors.url && <p className="mt-1.5 text-xs font-medium text-red-400">{errors.url}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Check every
              </label>
              <div className="relative">
                <Clock className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="number"
                  value={formData.intervalSeconds}
                  onChange={(e) => setFormData({ ...formData, intervalSeconds: Number(e.target.value) })}
                  min={30}
                  max={86400}
                  className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 tabular-nums transition-all"
                />
              </div>
              {errors.intervalSeconds && <p className="mt-1.5 text-xs font-medium text-red-400">{errors.intervalSeconds}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Timeout
              </label>
              <div className="relative">
                <ShieldAlert className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="number"
                  value={formData.timeoutMs}
                  onChange={(e) => setFormData({ ...formData, timeoutMs: Number(e.target.value) })}
                  min={1000}
                  max={30000}
                  className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 tabular-nums transition-all"
                />
              </div>
              {errors.timeoutMs && <p className="mt-1.5 text-xs font-medium text-red-400">{errors.timeoutMs}</p>}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-border/50">
            <Link
              href="/dashboard/monitors"
              className="px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold text-sm rounded-lg flex items-center gap-2 transition-all"
            >
              {submitting && <span className="inline-block animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
              Add monitor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
