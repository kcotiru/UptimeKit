import { describe, it, expect } from 'vitest';
import { safeRedirect } from '@/lib/shared/validations/redirect';

describe('safeRedirect', () => {
  it('keeps a same-origin path', () => {
    expect(safeRedirect('/dashboard/monitors/abc')).toBe('/dashboard/monitors/abc');
    expect(safeRedirect('/reset-password')).toBe('/reset-password');
  });

  it('falls back when nothing was requested', () => {
    expect(safeRedirect(null)).toBe('/dashboard/monitors');
    expect(safeRedirect(undefined)).toBe('/dashboard/monitors');
    expect(safeRedirect('')).toBe('/dashboard/monitors');
  });

  // Each of these would otherwise send a freshly authenticated user off-site.
  it.each([
    ['protocol-relative', '//evil.com'],
    ['absolute https', 'https://evil.com'],
    ['absolute http', 'http://evil.com/dashboard'],
    ['backslash escape', '/\\evil.com'],
    ['scheme-ish', 'javascript:alert(1)'],
    ['bare host', 'evil.com'],
  ])('rejects %s', (_label, value) => {
    expect(safeRedirect(value)).toBe('/dashboard/monitors');
  });

  it('honours an explicit fallback', () => {
    expect(safeRedirect('https://evil.com', '/login')).toBe('/login');
  });
});
