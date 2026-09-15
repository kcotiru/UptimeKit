/**
 * Builds an SVG polyline path for a sparkline, normalised to fill the box.
 *
 * Hand-rolled rather than pulled from a library: it is nine lines, and the app
 * already carries Recharts for the charts that actually need axes.
 *
 * @param values series in time order
 * @param width viewport width
 * @param height viewport height
 * @returns an SVG path, or '' when there is nothing to draw
 */
export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `M 0 ${height / 2} L ${width} ${height / 2}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width;
      // A flat series has no range; centre it instead of dividing by zero.
      const y = range === 0 ? height / 2 : height - ((value - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'} ${Math.round(x)} ${Math.round(y)}`;
    })
    .join(' ');
}

/** Evenly thins a series to at most `max` points, always keeping first and last. */
export function downsample<T>(values: T[], max: number): T[] {
  if (values.length <= max || max < 2) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}
