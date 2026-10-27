export const MIN_PASSWORD_LENGTH = 8;

/**
 * Client minimum, deliberately at or above the server's (supabase minimum_password_length)
 * so the user gets our message rather than the provider's. Null when acceptable.
 */
export function passwordError(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    : null;
}
