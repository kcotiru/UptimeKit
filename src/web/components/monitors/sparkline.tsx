import { sparklinePath } from '@/lib/shared/sparkline';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

/** A bare latency trace. No axes, no interaction — those live in the chart. */
export function Sparkline({ values, width = 160, height = 24, className }: SparklineProps) {
  const path = sparklinePath(values, width, height);
  if (!path) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Recent response times, ${values.length} samples`}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
