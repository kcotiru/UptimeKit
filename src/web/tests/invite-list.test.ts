import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('@/lib/server/actions/invites', () => ({
  createInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));

import { InviteList } from '../components/settings/invite-list';

const live = {
  id: 'i1',
  role: 'member',
  token: 'tok',
  revokedAt: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
} as never;

const render = (canInvite: boolean) =>
  renderToStaticMarkup(createElement(InviteList, { initialInvites: [live], canInvite }));

describe('InviteList', () => {
  it('shows copy and revoke to an admin', () => {
    const html = render(true);
    expect(html).toContain('Copy link');
    expect(html).toContain('Revoke invite link');
  });

  it('shows neither copy nor revoke to a non-admin', () => {
    const html = render(false);
    expect(html).not.toContain('Copy link');
    expect(html).not.toContain('Revoke invite link');
  });

  it('role labels contain no em dash', () => {
    expect(render(true)).not.toContain('\u2014');
  });
});
