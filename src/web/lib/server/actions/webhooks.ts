'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { getSessionUser, supabaseServer } from '../supabase';
import { createWebhook, deleteWebhook, getWebhook } from '../data/webhooks';
import { buildWebhookPayload } from '@shared/notifications/webhook-payload';
import { SSRFValidator } from '@shared/security/ssrf-validator';
import type { ActionResult, TeamWebhook } from '../../shared/types';

const ssrfValidator = new SSRFValidator();

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

/**
 * Creates a webhook for the signed-in team. The session is resolved here, not
 * in the data layer, so the data layer stays free of request-scoped concerns.
 */
export async function createWebhookAction(input: unknown): Promise<ActionResult<TeamWebhook>> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Not authenticated' };

    const webhook = await createWebhook(supabaseServer(), input, user.teamId);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: webhook };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/** Soft deletes a webhook. */
export async function deleteWebhookAction(id: string): Promise<ActionResult> {
  try {
    const deleted = await deleteWebhook(supabaseServer(), id);
    if (!deleted) return { ok: false, error: 'Webhook not found' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}

/**
 * Sends a sample notification so a user can confirm the destination works
 * without waiting for a real outage.
 *
 * The URL is re-validated here rather than trusted from the saved row: this
 * runs a server-side request, so it is an SSRF sink in its own right.
 */
export async function testWebhookAction(id: string): Promise<ActionResult<{ statusCode: number }>> {
  try {
    const webhook = await getWebhook(supabaseServer(), id);
    if (!webhook) return { ok: false, error: 'Webhook not found' };

    const ssrfResult = await ssrfValidator.validateUrl(webhook.url);
    if (!ssrfResult.isAllowed) {
      return { ok: false, error: ssrfResult.reason || 'URL is not a permitted destination' };
    }

    const payload = buildWebhookPayload(webhook.provider, {
      status: 'up',
      monitorUrl: 'https://example.com (test)',
      cause: 'Test notification from UptimeKit',
      monitorId: 'test',
      incidentId: 'test',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      return res.ok
        ? { ok: true, data: { statusCode: res.status } }
        : { ok: false, error: `Destination responded ${res.status}` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
}
