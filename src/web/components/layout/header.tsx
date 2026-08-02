import { Activity } from 'lucide-react';

/**
 * Props for the Header component.
 */
export interface HeaderProps {
  /** Page title heading */
  title: string;
  /** Optional subtitle context text */
  subtitle?: string;
}

/**
 * Dashboard top header bar displaying page title, subtitle, and live status indicator.
 */
export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="h-16 border-b border-surface-border bg-background/50 backdrop-blur px-8 flex items-center justify-between sticky top-0 z-10">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">Live System Monitoring</span>
      </div>
    </header>
  );
}
