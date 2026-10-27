/** Monitors and saved views: admins and members. Viewers are read only. */
export const MANAGE_ROLES = ['admin', 'member'] as const;
/** Webhooks are admin only: they hold outbound URLs and fire server-side requests. */
export const ADMIN_ROLES = ['admin'] as const;

/** Boolean form for UI gating, derived from the same sets the actions enforce. */
export const can = (user: { role: string } | null, roles: readonly string[]): boolean =>
  requireRole(user, roles) === null;

/**
 * Returns a sentence for a caller who may not proceed, or null when they may.
 * The database refuses the same operations; this exists so the user reads a
 * sentence instead of a raw privilege error. Not a 'use server' file on purpose:
 * those may only export async functions.
 */
export function requireRole(
  user: { role: string } | null,
  roles: readonly string[]
): string | null {
  if (!user) return 'Not authenticated';
  if (roles.includes(user.role)) return null;
  return roles.length === 1 && roles[0] === 'admin'
    ? 'Only team admins can do that'
    : 'Only team admins and members can do that';
}
