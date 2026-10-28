import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { getSessionUser } = vi.hoisted(() => ({ getSessionUser: vi.fn() }));

vi.mock('@/lib/server/data/webhooks', () => ({ listWebhooks: async () => [] }));
vi.mock('@/lib/server/data/saved-views', () => ({ listSavedViews: async () => [] }));
vi.mock('@/lib/server/data/invites', () => ({ listInvites: async () => [] }));
vi.mock('@/lib/server/supabase', () => ({ supabaseServer: () => ({}), getSessionUser }));
vi.mock('@/components/layout/header', () => ({ Header: () => null }));
vi.mock('@/components/settings/webhook-list', () => ({ WebhookList: () => 'WEBHOOKS' }));
vi.mock('@/components/settings/saved-view-list', () => ({ SavedViewList: () => 'VIEWS' }));
vi.mock('@/components/settings/invite-list', () => ({ InviteList: () => 'INVITES' }));

import SettingsPage from '../app/dashboard/settings/page';

const render = async () => renderToStaticMarkup(await SettingsPage());

beforeEach(() => vi.clearAllMocks());

describe('settings page gating', () => {
  it.each(['member', 'viewer'])('hides Alerts and Team members from a %s', async (role) => {
    getSessionUser.mockResolvedValue({ id: 'u', teamId: 't', role });
    const html = await render();
    expect(html).not.toContain('WEBHOOKS');
    expect(html).not.toContain('INVITES');
    expect(html).not.toContain('Team members');
    expect(html).toContain('VIEWS');
  });

  it('shows everything to an admin', async () => {
    getSessionUser.mockResolvedValue({ id: 'u', teamId: 't', role: 'admin' });
    const html = await render();
    expect(html).toContain('WEBHOOKS');
    expect(html).toContain('INVITES');
  });
});
