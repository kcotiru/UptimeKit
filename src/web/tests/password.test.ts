import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { passwordError } from '../lib/shared/password';

describe('passwordError', () => {
  it('rejects a short password with our own message', () => {
    expect(passwordError('1234567')).toBe('Password must be at least 8 characters.');
    expect(passwordError('')).toBe('Password must be at least 8 characters.');
  });
  it('accepts 8 characters', () => {
    expect(passwordError('12345678')).toBeNull();
  });
  it.each(['register-form', 'reset-password-form'])('%s runs the check before calling Supabase', (f) => {
    const src = readFileSync(`components/auth/${f}.tsx`, 'utf8');
    expect(src).toContain('passwordError(password)');
    expect(src.indexOf('passwordError(password)')).toBeLessThan(src.indexOf('supabaseBrowser().auth.'));
  });
});
