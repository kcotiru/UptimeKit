import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UserError } from '../../shared/action-error';
import { createInviteSchema } from '../../shared/validations/invite';
import type { TeamInvite } from '../../shared/types';

const INVITE_COLUMNS = 'id, team_id, creator_id, token, role, expires_at, revoked_at, created_at';

interface InviteRow {
  id: string;
  team_id: string;
  creator_id: string | null;
  token: string;
  role: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export function toInvite(row: InviteRow): TeamInvite {
  return {
    id: row.id,
    token: row.token,
    role: row.role,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

/** Every invite for the signed-in team. RLS supplies the team filter. */
export async function listInvites(db: SupabaseClient): Promise<TeamInvite[]> {
  const { data, error } = await db
    .from('team_invites')
    .select(INVITE_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toInvite);
}

/**
 * Validates and inserts an invite. `token` is omitted deliberately: the column
 * defaults to gen_share_token(), so the secret is generated in the database and
 * never passes through application code, exactly as saved_views does it.
 */
export async function createInvite(
  db: SupabaseClient,
  input: unknown,
  teamId: string,
  creatorId: string
): Promise<TeamInvite> {
  const parsed = createInviteSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? 'Invalid invite');
  const { role, expiresInDays } = parsed.data;

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('team_invites')
    .insert({ team_id: teamId, creator_id: creatorId, role, expires_at: expiresAt })
    .select(INVITE_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toInvite(data as InviteRow);
}

/** Kills a live invite link. Anyone who already joined with it keeps their seat. */
export async function revokeInvite(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db
    .from('team_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id');

  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
