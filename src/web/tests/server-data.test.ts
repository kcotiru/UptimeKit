import { describe, it, expect } from 'vitest';
import { listMonitors, deleteMonitor } from '../lib/server/data/monitors';
import { createWebhook } from '../lib/server/data/webhooks';

/**
 * Minimal stand-in for a Supabase query builder: every filter method returns
 * itself, and awaiting resolves to the canned result. Records what was asked
 * for so tests can assert the query shape rather than the mock's behaviour.
 */
function stubDb(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: {
    table?: string;
    filters: [string, unknown][];
    inserted?: Record<string, unknown>;
    updated?: Record<string, unknown>;
  } = { filters: [] };

  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    order: () => builder,
    eq: (k: string, v: unknown) => {
      calls.filters.push([k, v]);
      return builder;
    },
    insert: (row: Record<string, unknown>) => {
      calls.inserted = row;
      return builder;
    },
    update: (row: Record<string, unknown>) => {
      calls.updated = row;
      return builder;
    },
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  });

  const db = {
    from: (table: string) => {
      calls.table = table;
      return builder;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, calls };
}

const monitorRow = {
  id: 'm-1',
  team_id: 't-1',
  name: 'Prod API',
  url: 'https://api.example.com',
  check_interval: 60,
  status: 'up',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

describe('listMonitors', () => {
  it('reads non-deleted monitors and maps them to the client shape', async () => {
    const { db, calls } = stubDb({ data: [monitorRow], error: null });

    const result = await listMonitors(db);

    expect(calls.table).toBe('monitors');
    expect(calls.filters).toContainEqual(['is_deleted', false]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'm-1', teamId: 't-1', intervalSeconds: 60 });
  });

  it('surfaces the database error rather than returning empty', async () => {
    const { db } = stubDb({ data: null, error: { message: 'permission denied' } });

    await expect(listMonitors(db)).rejects.toThrow('permission denied');
  });
});

describe('deleteMonitor', () => {
  it('reports false when the monitor does not exist for this team', async () => {
    const { db } = stubDb({ data: [], error: null });

    expect(await deleteMonitor(db, 'missing')).toBe(false);
  });

  it('soft deletes rather than removing the row', async () => {
    const { db, calls } = stubDb({ data: [{ id: 'm-1' }], error: null });

    expect(await deleteMonitor(db, 'm-1')).toBe(true);
    expect(calls.updated).toMatchObject({ is_deleted: true });
    expect(calls.updated?.deleted_at).toEqual(expect.any(String));
  });
});

describe('createWebhook', () => {
  it('writes the team id supplied by the caller, not one it looked up itself', async () => {
    const { db, calls } = stubDb({
      data: {
        id: 'w-1',
        team_id: 't-9',
        provider: 'slack',
        url: 'https://hooks.slack.com/services/x',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    });

    const webhook = await createWebhook(
      db,
      { provider: 'slack', url: 'https://hooks.slack.com/services/x' },
      't-9'
    );

    expect(calls.table).toBe('team_webhooks');
    expect(calls.inserted).toMatchObject({ team_id: 't-9', provider: 'slack' });
    expect(webhook.teamId).toBe('t-9');
  });

  it('rejects an internal URL before touching the database', async () => {
    const { db, calls } = stubDb({ data: null, error: null });

    await expect(
      createWebhook(db, { provider: 'generic', url: 'http://169.254.169.254/' }, 't-9')
    ).rejects.toThrow(/public URL/);
    expect(calls.table).toBeUndefined();
  });
});
