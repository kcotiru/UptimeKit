import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A promise plus the resolve/reject that settle it, so a test can assert
 * every fetch was *started* before any of them finishes — proving the calls
 * run concurrently rather than in series. A test that only inspects the
 * final result would pass on sequential code too and prove nothing.
 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// vi.mock factories are hoisted above every other statement in the file, so the
// spies they close over have to be created by vi.hoisted rather than a plain
// const — otherwise the factory runs against an uninitialised binding.
const { listMonitors, listRecentMetrics, listWebhooks, listSavedViews, listInvites, getSessionUser } =
  vi.hoisted(() => ({
    listMonitors: vi.fn(),
    listRecentMetrics: vi.fn(),
    listWebhooks: vi.fn(),
    listSavedViews: vi.fn(),
    listInvites: vi.fn(),
    getSessionUser: vi.fn(),
  }));

vi.mock('@/lib/server/data/monitors', () => ({ listMonitors, listRecentMetrics }));
vi.mock('@/lib/server/data/webhooks', () => ({ listWebhooks }));
vi.mock('@/lib/server/data/saved-views', () => ({ listSavedViews }));
vi.mock('@/lib/server/data/invites', () => ({ listInvites }));
vi.mock('@/lib/server/supabase', () => ({ supabaseServer: () => ({}), getSessionUser }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MonitorsPage', () => {
  it('issues listMonitors and listRecentMetrics concurrently, not one after the other', async () => {
    const monitors = deferred<unknown[]>();
    const metrics = deferred<Map<string, unknown>>();
    listMonitors.mockReturnValue(monitors.promise);
    listRecentMetrics.mockReturnValue(metrics.promise);

    const { default: MonitorsPage } = await import('../app/dashboard/monitors/page');
    const pagePromise = MonitorsPage();

    // Sequential code would only call listRecentMetrics after listMonitors'
    // promise resolved — it hasn't, yet listRecentMetrics must already have
    // been invoked if the two run in parallel.
    await Promise.resolve();
    await Promise.resolve();
    expect(listMonitors).toHaveBeenCalledOnce();
    expect(listRecentMetrics).toHaveBeenCalledOnce();

    monitors.resolve([]);
    metrics.resolve(new Map());
    await pagePromise;
  });
});

describe('SettingsPage', () => {
  it('issues webhooks, views, invites and getSessionUser concurrently', async () => {
    const webhooks = deferred<unknown[]>();
    const views = deferred<unknown[]>();
    const invites = deferred<unknown[]>();
    const sessionUser = deferred<unknown>();
    listWebhooks.mockReturnValue(webhooks.promise);
    listSavedViews.mockReturnValue(views.promise);
    listInvites.mockReturnValue(invites.promise);
    getSessionUser.mockReturnValue(sessionUser.promise);

    const { default: SettingsPage } = await import('../app/dashboard/settings/page');
    const pagePromise = SettingsPage();

    await Promise.resolve();
    await Promise.resolve();
    expect(listWebhooks).toHaveBeenCalledOnce();
    expect(listSavedViews).toHaveBeenCalledOnce();
    expect(listInvites).toHaveBeenCalledOnce();
    expect(getSessionUser).toHaveBeenCalledOnce();

    webhooks.resolve([]);
    views.resolve([]);
    invites.resolve([]);
    sessionUser.resolve(null);
    await pagePromise;
  });
});
