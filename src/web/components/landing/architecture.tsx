/**
 * The architecture from README.md "How it works", as a static SVG.
 *
 * Drawn top to bottom so it stays legible at phone width. 1 unit is about
 * 1 CSS px at a 300px render, so 12 unit text is 12px. Boxes are 140 wide
 * and 44 tall, arrows are 1 unit strokes with a 4 unit head.
 * Two arrows carry the README's two points: the web app queries as the
 * signed-in user, so row level security applies; the worker connects as
 * `postgres` and bypasses it on purpose.
 */
const TIERS = [
  { label: 'Raw checks', note: 'Every individual check, for the recent past' },
  { label: 'Hourly rollups', note: 'Hourly summaries behind that' },
  { label: 'Daily rollups', note: 'Daily summaries behind that' },
];

const BOX = 'fill-surface stroke-surface-border';
const HEAD = 'fill-slate-400';

export function Architecture(): JSX.Element {
  return (
    <div>
      <svg viewBox="0 0 300 250" role="img" className="block h-auto w-full max-w-sm">
        <title>
          Architecture: the web dashboard queries Supabase Postgres as the signed-in user, so row
          level security enforces team isolation. The worker connects as postgres and bypasses row
          level security on purpose, and checks your URLs on the internet.
        </title>
        <g className={BOX} strokeWidth="1">
          <rect x="20" y="10" width="140" height="44" rx="6" />
          <rect x="20" y="100" width="140" height="44" rx="6" />
          <rect x="20" y="190" width="140" height="44" rx="6" />
        </g>
        <g className="stroke-slate-400" strokeWidth="1">
          <line x1="190" y1="32" x2="164" y2="32" />
          <line x1="90" y1="54" x2="90" y2="96" />
          <line x1="90" y1="190" x2="90" y2="148" />
          <line x1="160" y1="212" x2="186" y2="212" />
        </g>
        <g className={HEAD}>
          <polygon points="160,32 166,29 166,35" />
          <polygon points="90,100 87,94 93,94" />
          <polygon points="90,144 87,150 93,150" />
          <polygon points="190,212 184,209 184,215" />
        </g>
        <g className="fill-slate-100 text-[12px]" textAnchor="middle">
          <text x="90" y="29">Web dashboard</text>
          <text x="90" y="119">Supabase Postgres</text>
          <text x="90" y="209">Worker</text>
        </g>
        <g className="fill-slate-400 text-[11px]" textAnchor="middle">
          <text x="90" y="45">Next.js</text>
          <text x="90" y="135">auth + Postgres + RLS</text>
          <text x="90" y="225">BullMQ + Redis</text>
        </g>
        <g className="fill-slate-400 text-[12px]">
          <text x="196" y="36">you</text>
          <text x="192" y="216">your URLs</text>
          <text x="102" y="74">queries as the signed-in user,</text>
          <text x="102" y="88">row level security applies</text>
          <text x="102" y="164">connects as postgres,</text>
          <text x="102" y="178">bypasses it on purpose</text>
        </g>
      </svg>
      <ol className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIERS.map((t) => (
          <li key={t.label} className="rounded-lg border border-surface-border bg-surface px-4 py-3">
            <div className="text-sm font-medium text-slate-100">{t.label}</div>
            <div className="mt-0.5 text-sm text-slate-400">{t.note}</div>
          </li>
        ))}
      </ol>
      <p className="mt-4 max-w-xl text-sm text-slate-400">
        The chart picks whichever tier can answer the question asked. Old detail is rolled up and
        discarded on a schedule, so storage stays flat instead of growing forever.
      </p>
    </div>
  );
}
