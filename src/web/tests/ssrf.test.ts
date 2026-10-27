import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getSessionUser, getWebhook } = vi.hoisted(() => ({ getSessionUser: vi.fn(), getWebhook: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/server/supabase', () => ({ supabaseServer: () => ({}), getSessionUser }));
vi.mock('../lib/server/data/webhooks', () => ({ createWebhook: vi.fn(), deleteWebhook: vi.fn(), getWebhook }));

import { publicUrl } from '../lib/shared/validations/public-url';
import { SSRFValidator } from '@shared/security/ssrf-validator';
import { testWebhookAction } from '../lib/server/actions/webhooks';

const blocked = [
  'http://127.0.0.2/',
  'http://100.64.0.1/',
  'http://0.1.2.3/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[64:ff9b::7f00:1]/',
  'http://[2002:7f00:1::]/',
  'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/',
  'http://198.18.0.1/',
  'http://169.254.169.254/',
  'http://10.0.0.5/',
  'http://localhost/',
  'http://db.internal/',
];

// Real public addresses in both families: an allowlist that is too strict would break monitoring.
const allowed = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'];
const asUrl = (ip: string) => (ip.includes(':') ? `http://[${ip}]/` : `http://${ip}/`);

describe('publicUrl', () => {
  it.each(blocked)('rejects %s', (url) => {
    expect(publicUrl.safeParse(url).success).toBe(false);
  });
  it.each(allowed.map(asUrl))('accepts %s', (url) => {
    expect(publicUrl.safeParse(url).success).toBe(true);
  });
  it('accepts a normal public hostname', () => {
    expect(publicUrl.safeParse('https://example.com/health').success).toBe(true);
  });
});

describe('SSRFValidator', () => {
  const v = new SSRFValidator();
  it.each(blocked.filter((u) => !u.includes('localhost') && !u.includes('.internal')))('refuses %s', async (url) => {
    expect((await v.validateUrl(url)).isAllowed).toBe(false);
  });
  it.each(allowed.map(asUrl))('allows %s', async (url) => {
    expect((await v.validateUrl(url)).isAllowed).toBe(true);
  });
});

describe('testWebhookAction', () => {
  const id = '3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c';
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    getSessionUser.mockResolvedValue({ id: 'u1', teamId: 't1', role: 'admin' });
    getWebhook.mockResolvedValue({ id, url: 'http://8.8.8.8/hook', provider: 'generic' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not follow redirects', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await testWebhookAction(id);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('treats a 3xx as a failure', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 302, body: { cancel } });
    const res = await testWebhookAction(id);
    expect(res).toEqual({ ok: false, error: 'Destination responded 302' });
    expect(cancel).toHaveBeenCalled();
  });

  it('never returns the resolved ip or range of a refused url', async () => {
    getWebhook.mockResolvedValue({ id, url: 'http://10.1.2.3/hook', provider: 'generic' });
    const res = await testWebhookAction(id);
    expect(res).toEqual({ ok: false, error: 'URL is not a permitted destination' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
