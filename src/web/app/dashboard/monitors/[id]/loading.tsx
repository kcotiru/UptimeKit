export default function MonitorDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-6 w-32 bg-surface/50 rounded-lg" />
      <div className="h-32 bg-surface/50 rounded-2xl border border-surface-border" />
      <div className="h-80 bg-surface/50 rounded-2xl border border-surface-border" />
    </div>
  );
}
