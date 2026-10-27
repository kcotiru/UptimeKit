'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { getSessionUser, supabaseServer } from '../supabase';
import { MANAGE_ROLES, requireRole } from './require-role';
import { createMonitor, deleteMonitor, getMetrics } from '../data/monitors';
import { metricsWindow, uuidArg } from '../../shared/validations/action-args';
import { toUserMessage } from '../../shared/action-error';
import type { ActionResult, Monitor, PingMetric } from '../../shared/types';


/**
 * Creates a monitor for the signed-in team. Validation lives in the data layer,
 * so an invalid payload surfaces here as a failed result rather than a throw.
 */
export async function createMonitorAction(input: unknown): Promise<ActionResult<Monitor>> {
  try {
    const denied = requireRole(await getSessionUser(), MANAGE_ROLES);
    if (denied) return { ok: false, error: denied };
    const monitor = await createMonitor(supabaseServer(), input);
    revalidatePath('/dashboard/monitors');
    return { ok: true, data: monitor };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Soft deletes a monitor. Reports failure when it does not exist for this team. */
export async function deleteMonitorAction(id: string): Promise<ActionResult> {
  try {
    const denied = requireRole(await getSessionUser(), MANAGE_ROLES);
    if (denied) return { ok: false, error: denied };
    if (!uuidArg.safeParse(id).success) return { ok: false, error: 'Invalid id' };
    const deleted = await deleteMonitor(supabaseServer(), id);
    if (!deleted) return { ok: false, error: 'Monitor not found' };
    revalidatePath('/dashboard/monitors');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Time-series points for a monitor, refetched when the time range changes. */
export async function fetchMetricsAction(
  id: string,
  from: string,
  to: string
): Promise<ActionResult<PingMetric[]>> {
  try {
    // Session only: viewers read metrics. Row level security scopes the rows.
    if (!(await getSessionUser())) return { ok: false, error: 'Not authenticated' };
    const parsed = metricsWindow.safeParse({ id, from, to });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    return { ok: true, data: await getMetrics(supabaseServer(), id, from, to) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}
