'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';

export type { TimeRangePreset } from '@/lib/shared/types';
import type { TimeRangePreset } from '@/lib/shared/types';

/**
 * Props for the TimeRangePicker preset and custom timeframe component.
 */
export interface TimeRangePickerProps {
  /** Currently selected time range preset */
  selectedPreset: TimeRangePreset;
  /** Callback triggered when a new preset or custom time range is selected */
  onSelectPreset: (preset: TimeRangePreset, customFrom?: string, customTo?: string) => void;
}

/**
 * TimeRangePicker component providing preset range buttons and custom datetime bounds.
 */
export function TimeRangePicker({
  selectedPreset,
  onSelectPreset,
}: TimeRangePickerProps) {
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const presets: { id: TimeRangePreset; label: string }[] = [
    { id: '1h', label: 'Last 1 Hour' },
    { id: '24h', label: 'Last 24 Hours' },
    { id: '7d', label: 'Last 7 Days' },
    { id: '30d', label: 'Last 30 Days' },
  ];

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customFrom && customTo) {
      onSelectPreset('custom', new Date(customFrom).toISOString(), new Date(customTo).toISOString());
      setShowCustomModal(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-1 p-1 bg-surface border border-surface-border rounded-xl relative">
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-slate-500 text-xs font-semibold">
        <Calendar className="h-3.5 w-3.5" />
        Time Range:
      </div>

      {presets.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onSelectPreset(preset.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            selectedPreset === preset.id
              ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
          }`}
        >
          {preset.label}
        </button>
      ))}

      <button
        onClick={() => setShowCustomModal(true)}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
          selectedPreset === 'custom'
            ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/30 font-semibold'
            : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
        }`}
      >
        Custom
      </button>

      {showCustomModal && (
        <div className="absolute right-0 top-12 z-30 w-72 bg-surface border border-surface-border rounded-xl p-4 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Custom Timeframe</h4>
          <form onSubmit={handleApplyCustom} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Start (From)</label>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                required
                className="w-full px-2.5 py-1.5 bg-background border border-surface-border rounded-lg text-xs text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">End (To)</label>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                required
                className="w-full px-2.5 py-1.5 bg-background border border-surface-border rounded-lg text-xs text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-md shadow-sm"
              >
                Apply Range
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
