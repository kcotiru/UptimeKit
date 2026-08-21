import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TeamWebhook } from '../../shared/types';
import { createWebhookSchema } from '../../shared/validations/webhook';

const WEBHOOK_COLUMNS = 'id, team_id, provider, url, created_at';

interface WebhookRow {
  id: string;
  team_id: string;
  provider: string;
  url: string;
  created_at: string;
}

export function toWebhook(row: WebhookRow): TeamWebhook {
  return {
    id: row.id,
    teamId: row.team_id,
    provider: row.provider as TeamWebhook['provider'],
    url: row.url,
    createdAt: row.created_at,
  };
}

/** Lists the signed-in team's webhooks. Row level security scopes the result. */
export async function listWebhooks(db: SupabaseClient): Promise<TeamWebhook[]> {
  const { data, error } = await db
    .from('team_webhooks')
    .select(WEBHOOK_COLUMNS)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toWebhook);
}

export async function getWebhook(db: SupabaseClient, id: string): Promise<TeamWebhook | null> {
  const { data, error } = await db
    .from('team_webhooks')
    .select(WEBHOOK_COLUMNS)
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toWebhook(data) : null;
}

/**
 * Validates and inserts a webhook. Unlike `monitors`, team_webhooks.team_id has
 * no database default, so the team comes from the session; the row level
 * security check still rejects any attempt to name a different one.
 */
export async function createWebhook(
  db: SupabaseClient,
  input: unknown,
  teamId: string
): Promise<TeamWebhook> {
  const parsed = createWebhookSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid webhook');
  }

  const { data, error } = await db
    .from('team_webhooks')
    .insert({ team_id: teamId, provider: parsed.data.provider, url: parsed.data.url })
    .select(WEBHOOK_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toWebhook(data);
}

/** Soft deletes a webhook. Returns false when it does not exist for this team. */
export async function deleteWebhook(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db
    .from('team_webhooks')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('is_deleted', false)
    .select('id');

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
