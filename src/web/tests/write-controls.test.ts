import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { getSessionUser } = vi.hoisted(() => ({ getSessionUser: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('notFound');
  },
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
vi.mock('@/lib/server/supabase', () => ({
  supabaseServer: () => ({}),
  getSessionUser,
  getSessionClaims: async () => ({ email: 'a@b.c' }),
}));
vi.mock('@/lib/server/data/monitors', () => ({
  listMonitors: async () => [],
  listRecentMetrics: async () => new Map(),
  getMonitor: async () => ({ id: 'm1' }),
  getMetrics: async () => [],
}));
vi.mock('@/lib/server/data/webhooks', () => ({ listWebhooks: async () => [] }));
vi.mock('@/lib/server/data/saved-views', () => ({ listSavedViews: async () => [] }));
vi.mock('@/lib/server/data/invites', () => ({ listInvites: async () => [] }));
vi.mock('@/components/layout/header', () => ({
  Header: (p: { subtitle?: string }) => `HEADER:${p.subtitle ?? ''}`,
}));
// Page-level stubs print the canManage they were handed, so the page tests
// prove the threading without needing the real client components.
vi.mock('@/components/monitors/monitor-list', () => ({
  MonitorList: (p: { canManage: boolean }) => `LIST:${p.canManage}`,
}));
vi.mock('@/components/monitors/monitor-detail-view', () => ({
  MonitorDetailView: (p: { canManage: boolean }) => `DETAIL:${p.canManage}`,
}));
vi.mock('@/components/settings/saved-view-list', () => ({
  SavedViewList: (p: { canManage: boolean }) => `VIEWS:${p.canManage}`,
}));
vi.mock('@/components/settings/webhook-list', () => ({ WebhookList: () => 'WEBHOOKS' }));
vi.mock('@/components/settings/invite-list', () => ({ InviteList: () => 'INVITES' }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock('@/components/layout/sidebar', () => ({
  Sidebar: (p: { canManage: boolean }) => `SIDEBAR:${p.canManage}`,
}));
vi.mock('@/components/layout/top-bar', () => ({ TopBar: () => null }));
vi.mock('@/components/monitors/create-monitor-form', () => ({
  CreateMonitorForm: () => 'FORM',
}));

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const as = (role: string) => getSessionUser.mockResolvedValue({ id: 'u', teamId: 't', role });

beforeEach(() => vi.clearAllMocks());

describe('pages thread canManage from the session role', () => {
  it.each([
    ['admin', true],
    ['member', true],
    ['viewer', false],
  ])('monitors, detail and settings pages give a %s canManage=%s', async (role, expected) => {
    as(role);
    const monitors = (await import('../app/dashboard/monitors/page')).default;
    const detail = (await import('../app/dashboard/monitors/[id]/page')).default;
    const settings = (await import('../app/dashboard/settings/page')).default;
    expect(html(await monitors())).toContain(`LIST:${expected}`);
    expect(html(await detail({ params: { id: '3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c' }, searchParams: {} }))).toContain(
      `DETAIL:${expected}`
    );
    expect(html(await settings())).toContain(`VIEWS:${expected}`);
  });

  it.each([
    ['admin', true],
    ['member', true],
    ['viewer', false],
  ])('dashboard layout gives the sidebar canManage for a %s', async (role, expected) => {
    as(role);
    const layout = (await import('../app/dashboard/layout')).default;
    expect(html(await layout({ children: null }))).toContain(`SIDEBAR:${expected}`);
  });

  it('dashboard layout fails closed when the session lookup throws', async () => {
    getSessionUser.mockRejectedValue(new Error('boom'));
    const layout = (await import('../app/dashboard/layout')).default;
    expect(html(await layout({ children: null }))).toContain('SIDEBAR:false');
  });

  it('settings subtitle does not show a webhook count to non-admins', async () => {
    const settings = (await import('../app/dashboard/settings/page')).default;
    as('member');
    expect(html(await settings())).not.toContain('configured');
    as('admin');
    expect(html(await settings())).toContain('configured');
  });

  it('new monitor page shows the form to a member and a refusal to a viewer', async () => {
    const page = (await import('../app/dashboard/monitors/new/page')).default;
    as('member');
    expect(html(await page())).toContain('FORM');
    as('viewer');
    const out = html(await page());
    expect(out).not.toContain('FORM');
    expect(out).toContain('Only team admins and members can do that');
  });

  it('new monitor page shows the refusal, not the error boundary, when the session lookup throws', async () => {
    getSessionUser.mockRejectedValue(new Error('boom'));
    const page = (await import('../app/dashboard/monitors/new/page')).default;
    const out = html(await page());
    expect(out).not.toContain('FORM');
    expect(out).toContain('Not authenticated');
  });
});
