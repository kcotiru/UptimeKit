
/**
 * Props for the Header component.
 */
export interface HeaderProps {
  /** Page title heading */
  title: string;
  /** Optional subtitle context text */
  subtitle?: string;
  /** Right-aligned fact, e.g. "checked 12s ago". Omit when there isn't one. */
  meta?: string;
}

/**
 * Dashboard top header bar displaying page title, subtitle, and an optional fact.
 */
export function Header({ title, subtitle, meta }: HeaderProps) {
  return (
    <header className="h-16 border-b border-surface-border bg-background/50 backdrop-blur px-8 flex items-center justify-between sticky top-0 z-10">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      {meta && <span className="text-xs text-slate-400">{meta}</span>}
    </header>
  );
}
