import { z } from 'zod';

/**
 * A new team invite. Roles mirror the CHECK constraint on users.role and
 * team_invites.role — keep the three in step.
 *
 * 'admin' is offered because a team needs a way to grow a second owner, but it
 * is not the default: an invite link is a bearer capability, and the default
 * should be the least it can usefully grant.
 */
export const createInviteSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  // Bounded because an invite link that never expires is a permanent key to
  // the team sitting in someone's inbox.
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
