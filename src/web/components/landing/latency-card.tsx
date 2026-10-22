import { StatusWord } from '@/components/monitors/status-badge';

/**
 * One example endpoint, with an outage partway through its trace.
 *
 * Everything here is static: no client JavaScript, no charting library, no
 * data access. The figures underneath are a worked example and the arithmetic
 * is meant to be checkable:
 *
 *   x axis: 400 units = a 2 hour window, so 1 unit = 18 seconds.
 *           The alarm band is 30 units wide, which is 9m 00s of outage.
 *   uptime: 540s of 2,592,000s in 30 days is 0.021%, so 99.98%.
 *   y axis: 118 units = 0 to 600 ms, so y = 118 - ms * 118 / 600.
 *           The trace runs between roughly 127 and 163 ms before the outage,
 *           settles between roughly 200 and 320 ms after it, and spikes once
 *           to about 480 ms.
 *
 * The polylines are a downsample, which is what any real chart of this window
 * is: a 2 hour window at a check every 30 seconds is 240 samples, drawn here
 * as 20 vertices. `downsample` in `lib/shared/sparkline.ts`, covered by
 * `tests/sparkline.test.ts`, is what the real charts use to do the same.
 * The figures below are therefore percentiles over the 240 samples, not over
 * the 20 drawn vertices; the line only has to agree with them in shape and in
 * range, which it does, and the vertices alone will not reproduce them.
 *
 * The trace is two polylines, not one. A check that failed has no response
 * time, so nothing is drawn across the band: a line there would claim a
 * reading of nearly 0 ms. The alarm block carries the meaning instead.
 */
const TRACE_BEFORE = '0,91 20,89 40,93 60,87 80,90 100,91 120,88 140,89 160,92 180,86 200,89 228,88';
const TRACE_AFTER = '258,77 278,74 298,24 318,59 338,71 358,55 378,76 400,78';

const FIGURES = [
  { label: 'Outage', value: '9m 00s' },
  { label: 'p95', value: '311 ms' },
  { label: 'Uptime 30d', value: '99.98%' },
];

export function LatencyCard(): JSX.Element {
  return (
    <div className="rounded-lg border border-surface-border bg-surface">
      <div className="flex items-baseline gap-3 px-4 pb-2 pt-4">
        <span className="min-w-0 truncate text-sm font-medium text-slate-100">
          api.example.com/health
        </span>
        <StatusWord status="up" className="shrink-0" />
        <span className="ml-auto shrink-0 text-sm tabular-nums text-slate-400">p50 142 ms</span>
      </div>
      <svg
        viewBox="0 0 400 118"
        preserveAspectRatio="none"
        role="img"
        className="block h-32 w-full"
      >
        <title>
          Response time over the last 2 hours for the example endpoint, with a nine minute outage
          and a slower baseline after it.
        </title>
        {/* The outage, as a block rather than a gap: a missing line reads as missing data. */}
        <rect x="228" y="0" width="30" height="118" className="fill-surface-alarm" />
        <g className="stroke-surface-border" strokeWidth="1">
          <line x1="0" y1="30" x2="400" y2="30" />
          <line x1="0" y1="60" x2="400" y2="60" />
          <line x1="0" y1="90" x2="400" y2="90" />
        </g>
        {[TRACE_BEFORE, TRACE_AFTER].map((points) => (
          <polyline
            key={points}
            points={points}
            fill="none"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            className="stroke-brand-500"
          />
        ))}
      </svg>
      <div className="flex border-t border-surface-border">
        {FIGURES.map((f, i) => (
          <div
            key={f.label}
            className={`flex-1 px-4 py-3 ${i > 0 ? 'border-l border-surface-border' : ''}`}
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              {f.label}
            </div>
            <div className="mt-0.5 text-sm tabular-nums text-slate-100">{f.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
