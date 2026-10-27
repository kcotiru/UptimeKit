export const MIN_PASSWORD_LENGTH = 8;

/**
 * Matches supabase/config.toml minimum_password_length = 8, so the user gets our message
 * rather than the provider's. Keep the two in step. Null when acceptable.
 */
export function passwordError(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    : null;
}
