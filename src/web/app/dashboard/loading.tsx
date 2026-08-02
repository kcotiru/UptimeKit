export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 bg-surface/50 rounded-xl border border-surface-border" />
      <div className="flex items-center justify-between gap-4">
        <div className="h-10 w-full max-w-md bg-surface/50 rounded-xl" />
        <div className="h-10 w-32 bg-surface/50 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-44 bg-surface/50 rounded-xl border border-surface-border" />
        ))}
      </div>
    </div>
  );
}
