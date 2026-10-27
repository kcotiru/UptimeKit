import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMetrics, getMonitor, notFound } = vi.hoisted(() => ({
  getMetrics: vi.fn(),
  getMonitor: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/lib/server/data/monitors', () => ({ getMetrics, getMonitor }));
vi.mock('@/lib/server/supabase', () => ({
  supabaseServer: () => ({}),
  getSessionUser: async () => ({ id: 'u1', teamId: 't1', role: 'viewer' }),
}));
vi.mock('@/components/monitors/monitor-detail-view', () => ({ MonitorDetailView: () => null }));

import MonitorDetailPage from '../app/dashboard/monitors/[id]/page';

const ID = '3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c';
const DAY = 86_400_000;
const render = (id: string, searchParams: { from?: string; to?: string }) =>
  MonitorDetailPage({ params: { id }, searchParams });

beforeEach(() => {
  vi.clearAllMocks();
  getMonitor.mockResolvedValue({ id: ID });
  getMetrics.mockResolvedValue([]);
});

describe('monitor detail page window', () => {
  it('replaces an out-of-range window with the 24 hour default', async () => {
    await render(ID, { from: '1900-01-01T00:00:00Z', to: new Date().toISOString() });
    const [, id, from, to] = getMetrics.mock.calls[0];
    expect(id).toBe(ID);
    expect(from).not.toBe('1900-01-01T00:00:00Z');
    expect(Date.parse(to) - Date.parse(from)).toBe(DAY);
  });

  it('replaces an unparseable bound with the default instead of failing', async () => {
    const el = await render(ID, { from: 'garbage', to: 'also garbage' });
    expect(el).toBeTruthy();
    const [, , from, to] = getMetrics.mock.calls[0];
    expect(Date.parse(to) - Date.parse(from)).toBe(DAY);
  });

  it('passes a valid custom window through untouched', async () => {
    const from = '2026-01-01T00:00:00.000Z';
    const to = '2026-04-01T00:00:00.000Z';
    await render(ID, { from, to });
    expect(getMetrics).toHaveBeenCalledWith({}, ID, from, to);
  });

  it('uses the default window when no params are given', async () => {
    await render(ID, {});
    const [, , from, to] = getMetrics.mock.calls[0];
    expect(Date.parse(to) - Date.parse(from)).toBe(DAY);
  });
});

describe('monitor detail page id', () => {
  it('404s a non-uuid id without touching the database', async () => {
    await expect(render('../../etc', {})).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
    expect(getMonitor).not.toHaveBeenCalled();
    expect(getMetrics).not.toHaveBeenCalled();
  });
});
