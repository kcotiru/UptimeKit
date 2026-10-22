import type { MonitorStatus } from '@/lib/shared/types';
import { StatusWord } from '@/components/monitors/status-badge';

/**
 * A replica of the monitors list, as an example rather than live data.
 *
 * Broken sorts to the top, which is what `byUrgency` does on the real list,
 * and the down row sits on the alarm surface. Sparklines are hand-authored
 * polylines: healthy ones stay colourless, because healthy is not an event.
 *
 * `spark` is a list of segments, not one line. The down row's trace stops
 * where the endpoint stopped answering: a failed check has no response time,
 * so drawing on would claim readings that do not exist. The figures agree
 * with the latency card beside them, where the same endpoint reports
 * p50 142 ms and p95 311 ms.
 */
interface PreviewRow {
  name: string;
  status: MonitorStatus;
  p50: string;
  p95: string;
  spark: string[];
}

const ROWS: PreviewRow[] = [
  {
    name: 'marketing-site.example.com',
    status: 'down',
    p50: '-',
    p95: '-',
    spark: ['0,8 14,7 28,9 42,6 54,8'],
  },
  {
    name: 'status.example.com',
    status: 'degraded',
    p50: '5.4 s',
    p95: '8.2 s',
    spark: ['0,14 14,13 28,10 42,11 54,6 68,5 82,3 96,4'],
  },
  {
    name: 'api.example.com/health',
    status: 'up',
    p50: '142 ms',
    p95: '311 ms',
    spark: ['0,12 14,9 28,13 42,8 54,11 68,7 82,10 96,9'],
  },
  {
    name: 'checkout.example.com',
    status: 'up',
    p50: '96 ms',
    p95: '204 ms',
    spark: ['0,13 14,12 28,14 42,11 54,13 68,10 82,12 96,11'],
  },
];

const SPARK_TONES: Record<MonitorStatus, string> = {
  up: 'stroke-status-up',
  down: 'stroke-status-down',
  degraded: 'stroke-status-degraded',
  unknown: 'stroke-slate-400',
};

const LABEL = 'text-[11px] font-medium uppercase tracking-wider text-slate-400';
const ROW = 'flex items-center gap-3 border-b border-surface-border px-3 py-3 sm:gap-4 sm:px-4';

export function MonitorsPreview(): JSX.Element {
  return (
    <section className="border-t border-surface-border pt-8">
      <div className="px-4 pb-4 sm:px-8">
        <div className={LABEL}>The dashboard</div>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          Anything broken sorts to the top. One row per endpoint, with the last 3 hours beside it.
        </p>
      </div>
      {/* Bleeds off the bottom edge: the list continues past the fold rather than
          ending in a tidy card, so it reads as a shot of the real screen. */}
      <div className="-mb-px px-4 sm:px-10">
        <div className="overflow-hidden rounded-t-lg border border-b-0 border-surface-border bg-surface">
          <div className={ROW}>
            <span className={`min-w-0 flex-1 ${LABEL}`}>Endpoint</span>
            <span className={`w-20 shrink-0 ${LABEL}`}>Status</span>
            <span className={`hidden w-16 shrink-0 sm:block ${LABEL}`}>p50</span>
            <span className={`hidden w-16 shrink-0 sm:block ${LABEL}`}>p95</span>
            <span className={`w-16 shrink-0 sm:w-24 ${LABEL}`}>3h</span>
          </div>
          {ROWS.map((row) => (
            <div
              key={row.name}
              className={`${ROW} text-sm last:border-b-0 ${
                row.status === 'down' ? 'bg-surface-alarm' : ''
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-slate-100">{row.name}</span>
              <StatusWord status={row.status} className="w-20 shrink-0" />
              <span className="hidden w-16 shrink-0 tabular-nums text-slate-400 sm:block">
                {row.p50}
              </span>
              <span className="hidden w-16 shrink-0 tabular-nums text-slate-400 sm:block">
                {row.p95}
              </span>
              {/* Decorative: the status word already says what the row is, so a
                  screen reader gains nothing from four unlabelled trend images. */}
              <svg
                viewBox="0 0 96 20"
                aria-hidden="true"
                className="h-5 w-16 shrink-0 sm:w-24"
              >
                {row.spark.map((points) => (
                  <polyline
                    key={points}
                    points={points}
                    fill="none"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    className={SPARK_TONES[row.status]}
                  />
                ))}
              </svg>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
