/**
 * Narrows a caller-supplied redirect target to a same-origin path.
 *
 * Both the login form and the auth callback route hand a user somewhere after
 * authenticating, and both take that destination from the URL — so both are
 * open-redirect candidates: sign in on the real site, land on an attacker's
 * page that asks for the password "again".
 *
 * Anything absolute is rejected. `//evil.com` matters as much as
 * `https://evil.com`: a protocol-relative URL starts with a slash but still
 * leaves the origin.
 *
 * @param requested - the raw value from the query string, if any
 * @param fallback - where to go when the request is absent or unsafe
 */
export function safeRedirect(
  requested: string | null | undefined,
  fallback = '/dashboard/monitors'
): string {
  if (!requested) return fallback;
  if (!requested.startsWith('/')) return fallback;
  if (requested.startsWith('//')) return fallback;
  // A backslash is treated as a path separator by some browsers, so `/\evil.com`
  // can escape the origin the same way `//evil.com` does.
  if (requested.startsWith('/\\')) return fallback;
  return requested;
}
