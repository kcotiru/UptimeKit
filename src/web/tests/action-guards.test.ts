import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionUser, dataFns } = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dataFns: {
    createMonitor: vi.fn(),
    deleteMonitor: vi.fn(),
    getMetrics: vi.fn(),
    createWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    getWebhook: vi.fn(),
    createSavedView: vi.fn(),
    revokeSavedView: vi.fn(),
    deleteSavedView: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/server/supabase', () => ({ supabaseServer: () => ({}), getSessionUser }));
vi.mock('../lib/server/data/monitors', () => ({
  createMonitor: dataFns.createMonitor,
  deleteMonitor: dataFns.deleteMonitor,
  getMetrics: dataFns.getMetrics,
}));
vi.mock('../lib/server/data/webhooks', () => ({
  createWebhook: dataFns.createWebhook,
  deleteWebhook: dataFns.deleteWebhook,
  getWebhook: dataFns.getWebhook,
}));
vi.mock('../lib/server/data/saved-views', () => ({
  createSavedView: dataFns.createSavedView,
  revokeSavedView: dataFns.revokeSavedView,
  deleteSavedView: dataFns.deleteSavedView,
}));

import * as monitors from '../lib/server/actions/monitors';
import * as webhooks from '../lib/server/actions/webhooks';
import * as views from '../lib/server/actions/saved-views';

const actions: Record<string, (...args: never[]) => Promise<{ ok: boolean; error?: string }>> = {
  createMonitorAction: monitors.createMonitorAction,
  deleteMonitorAction: monitors.deleteMonitorAction,
  createWebhookAction: webhooks.createWebhookAction,
  deleteWebhookAction: webhooks.deleteWebhookAction,
  testWebhookAction: webhooks.testWebhookAction,
  createSavedViewAction: views.createSavedViewAction,
  revokeSavedViewAction: views.revokeSavedViewAction,
  deleteSavedViewAction: views.deleteSavedViewAction,
};

const user = (role: string) => ({ id: 'u1', teamId: 't1', role });
const call = (name: string) => (actions[name] as (a: unknown) => Promise<{ ok: boolean; error?: string }>)('3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c');
const touched = () => Object.values(dataFns).some((fn) => fn.mock.calls.length > 0);

beforeEach(() => {
  vi.clearAllMocks();
  dataFns.createMonitor.mockResolvedValue({ id: 'm1' });
});

describe('role guards', () => {
  // Webhook rows use member, not viewer: webhooks are admin only, so a member
  // must be refused too. A viewer-only row would pass with a member-allowing guard.
  it.each([
    ['createMonitorAction', 'viewer'],
    ['deleteMonitorAction', 'viewer'],
    ['createWebhookAction', 'member'],
    ['createWebhookAction', 'viewer'],
    ['deleteWebhookAction', 'member'],
    ['testWebhookAction', 'member'],
    ['createSavedViewAction', 'viewer'],
    ['revokeSavedViewAction', 'viewer'],
    ['deleteSavedViewAction', 'viewer'],
  ])('%s refuses a %s', async (name, role) => {
    getSessionUser.mockResolvedValue(user(role));
    const result = await call(name);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Only team (admins|admins and members) can/);
    expect(touched()).toBe(false);
  });

  it.each(Object.keys(actions))('%s refuses when there is no session', async (name) => {
    getSessionUser.mockResolvedValue(null);
    expect(await call(name)).toEqual({ ok: false, error: 'Not authenticated' });
    expect(touched()).toBe(false);
  });

  // Data mocks resolve undefined, so an allowed call ends in a "not found"
  // style result or ok; what matters is it was never refused for its role.
  it.each([
    ['createMonitorAction', 'member'],
    ['createMonitorAction', 'admin'],
    ['deleteMonitorAction', 'member'],
    ['createWebhookAction', 'admin'],
    ['deleteWebhookAction', 'admin'],
    ['testWebhookAction', 'admin'],
    ['createSavedViewAction', 'member'],
    ['createSavedViewAction', 'admin'],
    ['revokeSavedViewAction', 'member'],
    ['deleteSavedViewAction', 'member'],
    ['deleteSavedViewAction', 'admin'],
  ])('%s allows a %s past the role guard', async (name, role) => {
    getSessionUser.mockResolvedValue(user(role));
    const result = await call(name);
    expect(result.error ?? '').not.toMatch(/^(Only team|Not authenticated)/);
    expect(touched()).toBe(true);
  });

  it('a member may create a monitor', async () => {
    getSessionUser.mockResolvedValue(user('member'));
    expect(await call('createMonitorAction')).toEqual({ ok: true, data: { id: 'm1' } });
    expect(dataFns.createMonitor).toHaveBeenCalledOnce();
  });

  it('an admin may create a webhook', async () => {
    getSessionUser.mockResolvedValue(user('admin'));
    dataFns.createWebhook.mockResolvedValue({ id: 'w1' });
    expect(await call('createWebhookAction')).toEqual({ ok: true, data: { id: 'w1' } });
  });
});
