'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { getSessionUser, supabaseServer } from '../supabase';
import { MANAGE_ROLES, requireRole } from './require-role';
import { createSavedView, deleteSavedView, revokeSavedView } from '../data/saved-views';
import { uuidArg } from '../../shared/validations/action-args';
import { toUserMessage } from '../../shared/action-error';
import type { ActionResult, SavedView } from '../../shared/types';


/**
 * Saves a pinned window for the signed-in team. Mirrors createWebhookAction:
 * saved_views.team_id has no database default, so the team comes from the
 * session and row level security rejects any attempt to name a different one.
 */
export async function createSavedViewAction(input: unknown): Promise<ActionResult<SavedView>> {
  try {
    const user = await getSessionUser();
    const denied = requireRole(user, MANAGE_ROLES);
    if (denied || !user) return { ok: false, error: denied ?? 'Not authenticated' };

    const view = await createSavedView(supabaseServer(), input, user.teamId, user.id);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: view };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Kills a live share link. The saved window survives. */
export async function revokeSavedViewAction(id: string): Promise<ActionResult> {
  try {
    const denied = requireRole(await getSessionUser(), MANAGE_ROLES);
    if (denied) return { ok: false, error: denied };
    if (!uuidArg.safeParse(id).success) return { ok: false, error: 'Invalid id' };
    const revoked = await revokeSavedView(supabaseServer(), id);
    if (!revoked) return { ok: false, error: 'View not found or already revoked' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Removes the view entirely. */
export async function deleteSavedViewAction(id: string): Promise<ActionResult> {
  try {
    const denied = requireRole(await getSessionUser(), MANAGE_ROLES);
    if (denied) return { ok: false, error: denied };
    if (!uuidArg.safeParse(id).success) return { ok: false, error: 'Invalid id' };
    const deleted = await deleteSavedView(supabaseServer(), id);
    if (!deleted) return { ok: false, error: 'View not found' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}
