import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const { listMonitors, listRecentMetrics, getSessionUser } = vi.hoisted(() => ({
  listMonitors: vi.fn(),
  listRecentMetrics: vi.fn(),
  getSessionUser: vi.fn(),
}));
vi.mock('@/lib/server/data/monitors', () => ({ listMonitors, listRecentMetrics }));
vi.mock('@/lib/server/supabase', () => ({ supabaseServer: () => ({}), getSessionUser }));

import { MonitorRow } from '../components/monitors/monitor-row';

const monitor = (status: string) =>
  ({
    id: 'm1',
    teamId: 't',
    name: 'Checkout',
    url: 'https://example.com',
    intervalSeconds: 60,
    timeoutMs: 5000,
    status,
    lastCheckedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  }) as never;

const point = (o: { statusCode: number; isUp: boolean; successCount?: number; responseTimeMs?: number }) =>
  ({
    timestamp: '2026-01-01T00:00:00Z',
    responseTimeMs: 100,
    minMs: null,
    maxMs: null,
    p95Ms: null,
    p50Ms: null,
    p99Ms: null,
    sampleCount: 1,
    sourceTier: 'raw',
    successCount: o.successCount ?? (o.isUp ? 1 : 0),
    ...o,
  }) as never;

const render = (status: string, metrics: unknown[]) =>
  renderToStaticMarkup(
    createElement(MonitorRow, {
      monitor: monitor(status),
      renderedAt: Date.parse('2026-01-01T00:10:00Z'),
      metrics: metrics as never,
      onDeleteRequest: () => undefined,
      canManage: false,
    })
  );

describe('MonitorRow status rendering', () => {
  it('shows neither a status code nor a down label for a degraded monitor answering 200', () => {
    const html = render('degraded', [point({ statusCode: 200, isUp: true })]);
    expect(html).not.toContain('HTTP ');
    expect(html).not.toContain('down for');
    expect(html).toContain('>degraded<');
  });

  it('still shows the status code and the down label for a down monitor', () => {
    const html = render('down', [point({ statusCode: 503, isUp: false })]);
    expect(html).toContain('HTTP 503');
    expect(html).toContain('down for');
  });

  it('shows the status code for a degraded monitor whose code is the reason', () => {
    const html = render('degraded', [point({ statusCode: 301, isUp: true })]);
    expect(html).toContain('HTTP 301');
    expect(html).not.toContain('down for');
  });

  // isUp comes from the real listRecentMetrics predicate, not the fixture, so
  // this fails if a 301 ever stops counting as up.
  it('puts a degraded word beside an uptime that counts the redirect as up', async () => {
    const { listRecentMetrics: realListRecentMetrics } = await vi.importActual<
      typeof import('@/lib/server/data/monitors')
    >('@/lib/server/data/monitors');
    const rows = Array.from({ length: 20 }, () => ({
      monitor_id: 'm1',
      timestamp: '2026-01-01T00:00:00Z',
      response_time_ms: 100,
      status_code: 301,
    }));
    const db = { from: () => ({ select: () => ({ gte: () => ({ order: async () => ({ data: rows, error: null }) }) }) }) };
    const metrics = (await realListRecentMetrics(db as never, '2026-01-01T00:00:00Z')).get('m1')!;
    const html = render('degraded', metrics);
    expect(html).toContain('>degraded<');
    expect(html).toContain('uptime 100.0%');
    expect(html).not.toContain('down for');
  });
});

describe('MonitorRow latency figure', () => {
  it('shows the mean instead of a percentile when the window is too thin', () => {
    const html = render('up', [point({ statusCode: 200, isUp: true, responseTimeMs: 420 })]);
    expect(html).toContain('mean 420ms');
    expect(html).not.toContain('p50');
    expect(html).not.toContain('p95');
  });

  it('shows p50 and not the mean once the window supports a median', () => {
    const metrics = Array.from({ length: 20 }, (_, i) =>
      point({ statusCode: 200, isUp: true, responseTimeMs: (i + 1) * 10 })
    );
    const html = render('up', metrics);
    expect(html).toContain('p50');
    expect(html).toContain('p95');
    expect(html).not.toContain('mean');
  });
});

describe('MonitorsPage header', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts a degraded monitor separately rather than as down', async () => {
    listMonitors.mockResolvedValue([
      { ...(monitor('down') as object), id: 'a' },
      { ...(monitor('degraded') as object), id: 'b' },
      { ...(monitor('up') as object), id: 'c' },
    ]);
    listRecentMetrics.mockResolvedValue(new Map());
    getSessionUser.mockResolvedValue(null);

    const { default: MonitorsPage } = await import('../app/dashboard/monitors/page');
    const tree = (await MonitorsPage()) as { props: { children: Array<{ props: { subtitle: string } }> } };
    expect(tree.props.children[0].props.subtitle).toBe('3 endpoints, 1 down, 1 degraded');
  });
});
