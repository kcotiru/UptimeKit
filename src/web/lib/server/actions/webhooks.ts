'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { getSessionUser, supabaseServer } from '../supabase';
import { ADMIN_ROLES, requireRole } from './require-role';
import { createWebhook, deleteWebhook, getWebhook } from '../data/webhooks';
import { buildWebhookPayload } from '@shared/notifications/webhook-payload';
import { SSRFValidator } from '@shared/security/ssrf-validator';
import { uuidArg } from '../../shared/validations/action-args';
import { toUserMessage } from '../../shared/action-error';
import type { ActionResult, TeamWebhook } from '../../shared/types';

// Deliberately no allowlist: SSRF_ALLOWLIST does not apply to the Test button. Honouring it would
// need that env var duplicated on the web host and kept in step with the worker's. The cost is that
// Test refuses an allowlisted internal host the worker would accept. Do not "fix" this.
const ssrfValidator = new SSRFValidator();


/**
 * Creates a webhook for the signed-in team. The session is resolved here, not
 * in the data layer, so the data layer stays free of request-scoped concerns.
 */
export async function createWebhookAction(input: unknown): Promise<ActionResult<TeamWebhook>> {
  try {
    const user = await getSessionUser();
    const denied = requireRole(user, ADMIN_ROLES);
    if (denied || !user) return { ok: false, error: denied ?? 'Not authenticated' };

    const webhook = await createWebhook(supabaseServer(), input, user.teamId);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: webhook };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Soft deletes a webhook. */
export async function deleteWebhookAction(id: string): Promise<ActionResult> {
  try {
    const denied = requireRole(await getSessionUser(), ADMIN_ROLES);
    if (denied) return { ok: false, error: denied };
    if (!uuidArg.safeParse(id).success) return { ok: false, error: 'Invalid id' };
    const deleted = await deleteWebhook(supabaseServer(), id);
    if (!deleted) return { ok: false, error: 'Webhook not found' };
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
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
    const denied = requireRole(await getSessionUser(), ADMIN_ROLES);
    if (denied) return { ok: false, error: denied };
    if (!uuidArg.safeParse(id).success) return { ok: false, error: 'Invalid id' };
    const webhook = await getWebhook(supabaseServer(), id);
    if (!webhook) return { ok: false, error: 'Webhook not found' };

    const ssrfResult = await ssrfValidator.validateUrl(webhook.url);
    if (!ssrfResult.isAllowed) {
      // Generic on purpose: ssrfResult.reason carries the resolved internal IP and its range.
      return { ok: false, error: 'URL is not a permitted destination' };
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
        // Validated once above; following a redirect would send the request somewhere unchecked.
        redirect: 'manual',
      });

      if (res.ok) return { ok: true, data: { statusCode: res.status } };
      await res.body?.cancel(); // release the connection; the (possibly 3xx) body is never read
      return { ok: false, error: `Destination responded ${res.status}` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}
