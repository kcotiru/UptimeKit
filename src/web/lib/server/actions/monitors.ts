'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '../supabase';
import { createMonitor, deleteMonitor, getMetrics } from '../data/monitors';
import type { ActionResult, Monitor, PingMetric } from '../../shared/types';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

/**
 * Creates a monitor for the signed-in team. Validation lives in the data layer,
 * so an invalid payload surfaces here as a failed result rather than a throw.
 */
export async function createMonitorAction(input: unknown): Promise<ActionResult<Monitor>> {
  try {
    const monitor = await createMonitor(supabaseServer(), input);
    revalidatePath('/dashboard/monitors');
    return { ok: true, data: monitor };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/** Soft deletes a monitor. Reports failure when it does not exist for this team. */
export async function deleteMonitorAction(id: string): Promise<ActionResult> {
  try {
    const deleted = await deleteMonitor(supabaseServer(), id);
    if (!deleted) return { ok: false, error: 'Monitor not found' };
    revalidatePath('/dashboard/monitors');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/** Time-series points for a monitor, refetched when the time range changes. */
export async function fetchMetricsAction(
  id: string,
  from: string,
  to: string
): Promise<ActionResult<PingMetric[]>> {
  try {
    return { ok: true, data: await getMetrics(supabaseServer(), id, from, to) };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}
