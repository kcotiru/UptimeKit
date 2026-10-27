import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The URL carries a window metricsWindow would reject. The server fell back to
// the 24 hour window and passes it down as props.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams('from=garbage&to=1900-01-01T00:00:00Z'),
}));
vi.mock('@/lib/server/actions/monitors', () => ({ fetchMetricsAction: vi.fn() }));
vi.mock('../components/monitors/save-view-button', () => ({
  SaveViewButton: (p: { from: string; to: string }) => `SAVE[${p.from}|${p.to}]`,
}));

import { MonitorDetailView } from '../components/monitors/monitor-detail-view';

describe('MonitorDetailView window seed', () => {
  it('holds the server validated window, not the raw URL value', () => {
    const from = '2026-03-01T00:00:00.000Z';
    const to = '2026-03-02T00:00:00.000Z';
    const out = renderToStaticMarkup(
      createElement(MonitorDetailView, {
        monitor: { id: 'm1', name: 'Checkout', url: 'https://example.com' } as never,
        initialMetrics: [],
        from,
        to,
        renderedAt: 0,
        canManage: true,
      })
    );
    expect(out).toContain(`SAVE[${from}|${to}]`);
    expect(out).not.toContain('garbage');
  });
});
