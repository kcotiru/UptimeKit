'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createMonitorSchema, CreateMonitorSchema } from '@/lib/validations/monitor';
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
      // Dispatches request to Next.js API Route Handler proxy
      const res = await fetch('/api/v1/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.data),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setServerError(data.error || data.message || 'Failed to create monitor');
        setSubmitting(false);
        return;
      }

      router.push('/dashboard/monitors');
      router.refresh();
    } catch (error: unknown) {
      console.error('Error submitting create monitor form:', error instanceof Error ? error.message : error);
      setServerError('Unable to reach monitoring server. Please try again.');
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
          <ArrowLeft className="h-4 w-4" /> Back to Monitors
        </Link>
      </div>

      <div className="bg-surface border border-surface-border rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-50 tracking-tight">Create HTTP Health Monitor</h2>
          <p className="text-xs text-slate-400">Configure endpoint targets for background health checks and ping latency profiling.</p>
        </div>

        {serverError && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Monitor Name
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
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Target HTTP / HTTPS URL
            </label>
            <div className="relative">
              <Globe className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://api.acme.com/health"
                className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-mono transition-all"
              />
            </div>
            {errors.url && <p className="mt-1.5 text-xs font-medium text-red-400">{errors.url}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Check Interval (Seconds)
              </label>
              <div className="relative">
                <Clock className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="number"
                  value={formData.intervalSeconds}
                  onChange={(e) => setFormData({ ...formData, intervalSeconds: Number(e.target.value) })}
                  min={30}
                  max={86400}
                  className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-mono transition-all"
                />
              </div>
              {errors.intervalSeconds && <p className="mt-1.5 text-xs font-medium text-red-400">{errors.intervalSeconds}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Request Timeout (ms)
              </label>
              <div className="relative">
                <ShieldAlert className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="number"
                  value={formData.timeoutMs}
                  onChange={(e) => setFormData({ ...formData, timeoutMs: Number(e.target.value) })}
                  min={1000}
                  max={30000}
                  className="w-full pl-10 pr-4 py-2.5 bg-background/80 border border-surface-border rounded-lg text-sm text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-mono transition-all"
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
              className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-semibold text-sm rounded-lg shadow-lg shadow-brand-600/30 flex items-center gap-2 transition-all"
            >
              {submitting && <span className="inline-block animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
              Save & Start Monitoring
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
