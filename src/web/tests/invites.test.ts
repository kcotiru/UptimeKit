import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInviteSchema } from '../lib/shared/validations/invite';
import { toInvite } from '../lib/server/data/invites';

// vi.mock factories are hoisted above every other statement in the file, so the
// spies they close over have to be created by vi.hoisted rather than a plain
// const — otherwise the factory runs against an uninitialised binding.
const { sessionUser, createInvite, revokeInvite } = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));

vi.mock('../lib/server/supabase', () => ({
  getSessionUser: () => sessionUser(),
  supabaseServer: () => ({}),
}));

vi.mock('../lib/server/data/invites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/data/invites')>()),
  createInvite: (...args: unknown[]) => createInvite(...args),
  revokeInvite: (...args: unknown[]) => revokeInvite(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

describe('createInviteSchema', () => {
  it('defaults to the least useful role and a week of life', () => {
    const result = createInviteSchema.parse({});
    expect(result).toEqual({ role: 'member', expiresInDays: 7 });
  });

  it('accepts the three roles the database CHECK constraint allows', () => {
    for (const role of ['admin', 'member', 'viewer']) {
      expect(createInviteSchema.safeParse({ role }).success).toBe(true);
    }
  });

  it('rejects a role outside the constraint', () => {
    expect(createInviteSchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(createInviteSchema.safeParse({ role: 'superuser' }).success).toBe(false);
  });

  // An invite link is a bearer capability sitting in an inbox; unbounded life
  // makes it a permanent key to the team.
  it.each([
    ['zero days', 0],
    ['negative', -1],
    ['beyond a month', 31],
    ['fractional', 1.5],
  ])('rejects %s expiry', (_label, expiresInDays) => {
    expect(createInviteSchema.safeParse({ expiresInDays }).success).toBe(false);
  });
});

describe('toInvite', () => {
  it('maps an invite row to the client shape', () => {
    expect(
      toInvite({
        id: 'i1',
        team_id: 't1',
        creator_id: 'u1',
        token: 'a'.repeat(43),
        role: 'viewer',
        expires_at: '2026-09-12T00:00:00Z',
        revoked_at: null,
        created_at: '2026-09-05T00:00:00Z',
      })
    ).toEqual({
      id: 'i1',
      token: 'a'.repeat(43),
      role: 'viewer',
      expiresAt: '2026-09-12T00:00:00Z',
      revokedAt: null,
      createdAt: '2026-09-05T00:00:00Z',
    });
  });
});

// RLS scopes team_invites by team but cannot tell an admin from a viewer:
// every member of the team satisfies `team_id = current_team_id()`. Without
// this gate a viewer could mint themselves an admin invite and re-register
// into their own team with full access.
describe('createInviteAction role gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInvite.mockResolvedValue({ id: 'i1', role: 'member' });
    revokeInvite.mockResolvedValue(true);
  });

  it.each(['viewer', 'member'])('refuses a %s and never reaches the database', async (role) => {
    const { createInviteAction } = await import('../lib/server/actions/invites');
    sessionUser.mockResolvedValue({ id: 'u1', teamId: 't1', email: 'x@y.z', role });

    const result = await createInviteAction({ role: 'admin', expiresInDays: 7 });

    expect(result).toEqual({ ok: false, error: 'Only team admins can create invites' });
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    const { createInviteAction } = await import('../lib/server/actions/invites');
    sessionUser.mockResolvedValue(null);

    const result = await createInviteAction({});

    expect(result).toEqual({ ok: false, error: 'Not authenticated' });
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('lets an admin through', async () => {
    const { createInviteAction } = await import('../lib/server/actions/invites');
    sessionUser.mockResolvedValue({ id: 'u1', teamId: 't1', email: 'x@y.z', role: 'admin' });

    const result = await createInviteAction({ role: 'member', expiresInDays: 7 });

    expect(result.ok).toBe(true);
    expect(createInvite).toHaveBeenCalledOnce();
  });

  it('gates revoke on the same role', async () => {
    const { revokeInviteAction } = await import('../lib/server/actions/invites');
    sessionUser.mockResolvedValue({ id: 'u1', teamId: 't1', email: 'x@y.z', role: 'viewer' });

    const result = await revokeInviteAction('i1');

    expect(result).toEqual({ ok: false, error: 'Only team admins can revoke invites' });
    expect(revokeInvite).not.toHaveBeenCalled();
  });
});
