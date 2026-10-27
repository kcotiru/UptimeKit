import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/server/actions/monitors', () => ({
  deleteMonitorAction: vi.fn(),
  fetchMetricsAction: vi.fn(),
}));
vi.mock('@/lib/server/actions/saved-views', () => ({
  createSavedViewAction: vi.fn(),
  deleteSavedViewAction: vi.fn(),
  revokeSavedViewAction: vi.fn(),
}));

import { MonitorList } from '../components/monitors/monitor-list';
import { MonitorRow } from '../components/monitors/monitor-row';
import { MonitorDetailView } from '../components/monitors/monitor-detail-view';
import { Sidebar } from '../components/layout/sidebar';
import { SavedViewList } from '../components/settings/saved-view-list';

const monitor = {
  id: 'm1',
  teamId: 't',
  name: 'Checkout',
  url: 'https://example.com',
  intervalSeconds: 60,
  timeoutMs: 5000,
  status: 'up',
  lastCheckedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
} as never;
const view = {
  id: 'v1',
  name: 'Outage',
  from: '2026-01-01T00:00:00Z',
  to: '2026-01-02T00:00:00Z',
  shareToken: 'tok',
  revokedAt: null,
} as never;

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('monitor list controls', () => {
  const list = (canManage: boolean, monitors: unknown[]) =>
    html(
      createElement(MonitorList, {
        initialMonitors: monitors as never,
        metricsByMonitor: {},
        renderedAt: 0,
        canManage,
      })
    );

  it('shows Add monitor and row delete when canManage', () => {
    const out = list(true, [monitor]);
    expect(out).toContain('Add monitor');
    expect(out).toContain('Delete Checkout');
  });

  it('hides Add monitor and row delete when not canManage, keeps the row', () => {
    const out = list(false, [monitor]);
    expect(out).not.toContain('Add monitor');
    expect(out).not.toContain('Delete Checkout');
    expect(out).toContain('Checkout');
  });

  it('hides the empty-state Add link when not canManage', () => {
    expect(list(true, [])).toContain('Add your first monitor');
    expect(list(false, [])).not.toContain('Add your first monitor');
  });

  it('MonitorRow hides delete when not canManage', () => {
    const row = (canManage: boolean) =>
      html(
        createElement(MonitorRow, {
          monitor,
          metrics: [],
          renderedAt: 0,
          onDeleteRequest: () => undefined,
          canManage,
        })
      );
    expect(row(true)).toContain('Delete Checkout');
    expect(row(false)).not.toContain('Delete Checkout');
  });
});

describe('saved view controls', () => {
  const list = (canManage: boolean) =>
    html(createElement(SavedViewList, { initialViews: [view], canManage }));

  it('shows revoke and delete when canManage', () => {
    const out = list(true);
    expect(out).toContain('Revoke share link');
    expect(out).toContain('Delete saved view');
  });

  it('hides revoke and delete when not canManage, keeps the list', () => {
    const out = list(false);
    expect(out).not.toContain('Revoke share link');
    expect(out).not.toContain('Delete saved view');
    expect(out).toContain('Outage');
  });
});

describe('sidebar nav', () => {
  const render = (canManage: boolean) =>
    html(createElement(Sidebar, { initialMode: 'expanded', canManage }));

  it('offers the Add monitor child only when canManage', () => {
    expect(render(true)).toContain('Add monitor');
    expect(render(false)).not.toContain('Add monitor');
    expect(render(false)).toContain('Monitors');
  });
});

describe('detail view share button', () => {
  const render = (canManage: boolean) =>
    html(
      createElement(MonitorDetailView, {
        monitor,
        initialMetrics: [],
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        renderedAt: 0,
        canManage,
      })
    );

  it('shows Share this window only when canManage', () => {
    expect(render(true)).toContain('Share this window');
    expect(render(false)).not.toContain('Share this window');
  });
});
