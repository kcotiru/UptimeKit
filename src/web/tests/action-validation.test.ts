import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionUser, dataFns } = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dataFns: {
    deleteMonitor: vi.fn(),
    getMetrics: vi.fn(),
    deleteWebhook: vi.fn(),
    getWebhook: vi.fn(),
    revokeSavedView: vi.fn(),
    deleteSavedView: vi.fn(),
    revokeInvite: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/server/supabase', () => ({ supabaseServer: () => ({}), getSessionUser }));
vi.mock('../lib/server/data/monitors', () => ({
  createMonitor: vi.fn(),
  deleteMonitor: dataFns.deleteMonitor,
  getMetrics: dataFns.getMetrics,
}));
vi.mock('../lib/server/data/webhooks', () => ({
  createWebhook: vi.fn(),
  deleteWebhook: dataFns.deleteWebhook,
  getWebhook: dataFns.getWebhook,
}));
vi.mock('../lib/server/data/saved-views', () => ({
  createSavedView: vi.fn(),
  revokeSavedView: dataFns.revokeSavedView,
  deleteSavedView: dataFns.deleteSavedView,
}));
vi.mock('../lib/server/data/invites', () => ({
  createInvite: vi.fn(),
  revokeInvite: dataFns.revokeInvite,
}));

import * as monitors from '../lib/server/actions/monitors';
import * as webhooks from '../lib/server/actions/webhooks';
import * as views from '../lib/server/actions/saved-views';
import * as invites from '../lib/server/actions/invites';

const ID = '3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c';
const touched = () => Object.values(dataFns).some((fn) => fn.mock.calls.length > 0);
const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (offsetDays: number) => new Date(T0 + offsetDays * DAY).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue({ id: 'u1', teamId: 't1', email: 'a@b.c', role: 'admin' });
  for (const fn of [dataFns.deleteMonitor, dataFns.deleteWebhook, dataFns.revokeSavedView, dataFns.deleteSavedView, dataFns.revokeInvite]) {
    fn.mockResolvedValue(true);
  }
  dataFns.getWebhook.mockResolvedValue(null);
  dataFns.getMetrics.mockResolvedValue([]);
});

describe('id arguments', () => {
  const idActions: [string, (id: string) => Promise<{ ok: boolean; error?: string }>][] = [
    ['deleteMonitorAction', monitors.deleteMonitorAction],
    ['deleteWebhookAction', webhooks.deleteWebhookAction],
    ['testWebhookAction', webhooks.testWebhookAction],
    ['revokeSavedViewAction', views.revokeSavedViewAction],
    ['deleteSavedViewAction', views.deleteSavedViewAction],
    ['revokeInviteAction', invites.revokeInviteAction],
  ];

  it.each(idActions)('%s rejects a non-uuid id before touching the database', async (_n, action) => {
    const result = await action('../../etc');
    expect(result).toEqual({ ok: false, error: 'Invalid id' });
    expect(touched()).toBe(false);
  });

  it.each(idActions)('%s lets a real uuid reach the data layer', async (_n, action) => {
    await action(ID);
    expect(touched()).toBe(true);
  });
});

describe('fetchMetricsAction', () => {
  it('rejects a window wider than the cap', async () => {
    const result = await monitors.fetchMetricsAction(ID, iso(0), iso(401));
    expect(result).toEqual({ ok: false, error: 'Time window is too wide' });
    expect(touched()).toBe(false);
  });

  it('rejects to before from', async () => {
    const result = await monitors.fetchMetricsAction(ID, iso(10), iso(5));
    expect(result).toEqual({ ok: false, error: 'End must be after start' });
    expect(touched()).toBe(false);
  });

  it('rejects a non-timestamp bound', async () => {
    const result = await monitors.fetchMetricsAction(ID, 'yesterday', iso(1));
    expect(result).toEqual({ ok: false, error: 'Invalid time window' });
    expect(touched()).toBe(false);
  });

  it('rejects a non-uuid id', async () => {
    const result = await monitors.fetchMetricsAction('nope', iso(0), iso(1));
    expect(result).toEqual({ ok: false, error: 'Invalid id' });
    expect(touched()).toBe(false);
  });

  it.each([30, 90, 400])('accepts a %i day window', async (days) => {
    const result = await monitors.fetchMetricsAction(ID, iso(0), iso(days));
    expect(result).toEqual({ ok: true, data: [] });
    expect(dataFns.getMetrics).toHaveBeenCalledWith({}, ID, iso(0), iso(days));
  });

  it('requires a session but no particular role', async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await monitors.fetchMetricsAction(ID, iso(0), iso(1))).toEqual({
      ok: false,
      error: 'Not authenticated',
    });
    expect(touched()).toBe(false);

    getSessionUser.mockResolvedValue({ id: 'u1', teamId: 't1', email: 'a@b.c', role: 'viewer' });
    expect((await monitors.fetchMetricsAction(ID, iso(0), iso(1))).ok).toBe(true);
  });
});
