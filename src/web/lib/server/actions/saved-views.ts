'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { getSessionUser, supabaseServer } from '../supabase';
import { createSavedView, deleteSavedView, revokeSavedView } from '../data/saved-views';
import type { ActionResult, SavedView } from '../../shared/types';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

/**
 * Saves a pinned window for the signed-in team. Mirrors createWebhookAction:
 * saved_views.team_id has no database default, so the team comes from the
 * session and row level security rejects any attempt to name a different one.
 */
export async function createSavedViewAction(input: unknown): Promise<ActionResult<SavedView>> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Not authenticated' };

    const view = await createSavedView(supabaseServer(), input, user.teamId);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: view };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/** Kills a live share link. The saved window survives. */
export async function revokeSavedViewAction(id: string): Promise<ActionResult> {
  try {
    const revoked = await revokeSavedView(supabaseServer(), id);
    if (!revoked) return { ok: false, error: 'View not found or already revoked' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/** Removes the view entirely. */
export async function deleteSavedViewAction(id: string): Promise<ActionResult> {
  try {
    const deleted = await deleteSavedView(supabaseServer(), id);
    if (!deleted) return { ok: false, error: 'View not found' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}
