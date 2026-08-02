'use client';

import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Monitor } from '@/lib/types';

/**
 * Props for the DeleteMonitorModal confirmation dialog.
 */
export interface DeleteMonitorModalProps {
  /** Target monitor entity to be deleted or null if modal is closed */
  monitor: Monitor | null;
  /** Callback triggered to dismiss the deletion dialog */
  onClose: () => void;
  /** Async callback executed to confirm monitor deletion */
  onConfirmDelete: (id: string) => Promise<void>;
}

/**
 * Modal confirmation dialog for permanently deleting an HTTP health monitor.
 */
export function DeleteMonitorModal({
  monitor,
  onClose,
  onConfirmDelete,
}: DeleteMonitorModalProps) {
  const [deleting, setDeleting] = useState(false);

  if (!monitor) return null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onConfirmDelete(monitor.id);
      onClose();
    } catch (error: unknown) {
      console.error('Monitor deletion failed:', error instanceof Error ? error.message : error);
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-surface-border rounded-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-lg">Delete Monitor</h3>
              <p className="text-xs text-slate-400">This action cannot be undone</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-slate-300">
          Are you sure you want to delete monitor <strong className="text-slate-100">{monitor.name}</strong> ({monitor.url})? All associated performance metrics and history will be permanently deleted.
        </p>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-border/50">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-surface-hover rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg shadow-lg shadow-red-600/30 transition-colors flex items-center gap-2"
          >
            {deleting && <span className="inline-block animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />}
            Confirm Deletion
          </button>
        </div>
      </div>
    </div>
  );
}
