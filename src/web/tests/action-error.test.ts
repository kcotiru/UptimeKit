import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { toUserMessage, UserError, GENERIC_ERROR } from '../lib/shared/action-error';
import { requireRole, MANAGE_ROLES, ADMIN_ROLES } from '../lib/server/actions/require-role';
import { uuidArg } from '../lib/shared/validations/action-args';

afterEach(() => vi.restoreAllMocks());

// Realistic PostgREST / Postgres shapes, as the data layer rethrows them: new Error(error.message).
const LEAKY: Error[] = [
  new Error('new row violates row-level security policy for table "monitors"'),
  new Error('permission denied for table team_invites'),
  new Error('invalid input syntax for type uuid: "abc"'),
  new Error('invalid input syntax for type timestamp with time zone: "yesterday"'),
  new Error('duplicate key value violates unique constraint "saved_views_token_key"'),
  new Error('insert or update on table "team_webhooks" violates foreign key constraint "team_webhooks_team_id_fkey"'),
];
const SCHEMA_NAMES = [
  'monitors', 'team_invites', 'saved_views', 'team_webhooks', 'saved_views_token_key',
  'team_webhooks_team_id_fkey', 'uuid', 'timestamp', 'constraint', 'row-level security', 'permission denied',
];

describe('toUserMessage', () => {
  it('passes a zod message through, because it is the user own input problem', () => {
    const r = z.object({ url: z.string().min(1, 'URL is required') }).safeParse({ url: '' });
    if (r.success) throw new Error('expected failure');
    expect(toUserMessage(r.error)).toBe('URL is required');
  });

  it('passes a UserError through', () => {
    expect(toUserMessage(new UserError('Interval must be at least 30 seconds'))).toBe(
      'Interval must be at least 30 seconds'
    );
  });

  it('passes requireRole and uuid messages through unchanged', () => {
    const denied = [requireRole(null, MANAGE_ROLES), requireRole({ role: 'viewer' }, MANAGE_ROLES), requireRole({ role: 'member' }, ADMIN_ROLES)];
    for (const d of denied) expect(toUserMessage(new UserError(d as string))).toBe(d);
    const bad = uuidArg.safeParse('nope');
    if (bad.success) throw new Error('expected failure');
    expect(toUserMessage(bad.error)).toBe(bad.error.issues[0].message);
  });

  it('replaces a postgrest error with a generic message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toUserMessage({ code: '42501', message: 'new row violates row-level security policy for table "monitors"' })).toBe(
      'Something went wrong. Please try again.'
    );
  });

  it('never returns a table or constraint name, for a set of real shapes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const inputs: unknown[] = [...LEAKY, { code: '42501', message: 'permission denied for table monitors' }, 'raw string with saved_views'];
    for (const input of inputs) {
      const out = toUserMessage(input);
      expect(out).toBe(GENERIC_ERROR);
      for (const name of SCHEMA_NAMES) expect(out).not.toContain(name);
    }
  });

  it('logs the original server side', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = LEAKY[0];
    toUserMessage(err);
    expect(spy).toHaveBeenCalledWith(expect.any(String), err);
  });

  it('does not log a message it passes through', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    toUserMessage(new UserError('URL is required'));
    expect(spy).not.toHaveBeenCalled();
  });
});
