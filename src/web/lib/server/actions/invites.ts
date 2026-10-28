'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { getSessionUser, supabaseServer } from '../supabase';
import { createInvite, revokeInvite } from '../data/invites';
import { uuidArg } from '../../shared/validations/action-args';
import { toUserMessage } from '../../shared/action-error';
import type { ActionResult, TeamInvite } from '../../shared/types';


/**
 * Mints an invite link for the signed-in team.
 *
 * Row level security scopes team_invites to the caller's team, so it already
 * stops one team inviting into another. It does NOT distinguish roles: every
 * authenticated member of a team passes `team_id = current_team_id()`. Without
 * the check below, a 'viewer' could mint themselves an admin invite and
 * re-register into their own team as an admin. The gate has to live here.
 */
export async function createInviteAction(input: unknown): Promise<ActionResult<TeamInvite>> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Not authenticated' };
    if (user.role !== 'admin') return { ok: false, error: 'Only team admins can create invites' };

    const invite = await createInvite(supabaseServer(), input, user.teamId, user.id);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: invite };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Kills a live invite link. Members who already joined with it keep their seat. */
export async function revokeInviteAction(id: string): Promise<ActionResult> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Not authenticated' };
    if (user.role !== 'admin') return { ok: false, error: 'Only team admins can revoke invites' };
    if (!uuidArg.safeParse(id).success) return { ok: false, error: 'Invalid id' };

    const revoked = await revokeInvite(supabaseServer(), id);
    if (!revoked) return { ok: false, error: 'Invite not found or already revoked' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}
