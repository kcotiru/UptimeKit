import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';

const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

/**
 * Covers handle_new_user() — the AFTER INSERT trigger on auth.users that
 * replaces the old /api/auth/register route. Every case here inserts straight
 * into auth.users, which is exactly what supabase.auth.signUp() does.
 */
suite('Signup trigger', () => {
  let client: Client;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);
  }, 60_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  // users.email is UNIQUE and applySchema() does not truncate, so fixed
  // addresses collide on the second run against the same test database.
  const run = Date.now().toString(36);
  const addr = (local: string) => `${local}+${run}@example.test`;

  /** Inserts an auth user with the metadata a signUp() call would carry. */
  async function signUp(email: string, meta: Record<string, unknown> = {}) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO auth.users (email, raw_user_meta_data)
       VALUES ($1, $2::jsonb) RETURNING id`,
      [email, JSON.stringify(meta)]
    );
    return rows[0].id;
  }

  /** Creates a team plus a live invite on it, returning both. */
  async function seedInvite(
    role = 'member',
    overrides: { revoked?: boolean; expired?: boolean } = {}
  ) {
    const { rows: [team] } = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('Acme Engineering') RETURNING id`
    );
    const { rows: [invite] } = await client.query<{ token: string }>(
      `INSERT INTO team_invites (team_id, role, expires_at, revoked_at)
       VALUES ($1, $2, NOW() + ($3 || ' days')::interval, $4)
       RETURNING token`,
      [team.id, role, overrides.expired ? '-1' : '7', overrides.revoked ? new Date() : null]
    );
    return { teamId: team.id, token: invite.token };
  }

  async function profileOf(userId: string) {
    const { rows } = await client.query<{ team_id: string; role: string; email: string }>(
      'SELECT team_id, role, email FROM users WHERE id = $1',
      [userId]
    );
    return rows[0];
  }

  it('creates a team and an admin profile for a plain signup', async () => {
    const before = await client.query('SELECT count(*)::int AS n FROM teams');

    const userId = await signUp(addr('founder'), { team_name: 'Acme Engineering' });
    const profile = await profileOf(userId);

    expect(profile.role).toBe('admin');
    expect(profile.email).toBe(addr('founder'));

    const { rows: [team] } = await client.query('SELECT name FROM teams WHERE id = $1', [
      profile.team_id,
    ]);
    expect(team.name).toBe('Acme Engineering');

    const after = await client.query('SELECT count(*)::int AS n FROM teams');
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
  });

  it('names the team from the email when no team name is supplied', async () => {
    const userId = await signUp(addr('solo'));
    const { team_id } = await profileOf(userId);

    const { rows: [team] } = await client.query('SELECT name FROM teams WHERE id = $1', [team_id]);
    expect(team.name).toBe(`${addr('solo').split('@')[0]}'s team`);
  });

  it('joins the invited team at the invited role, creating no new team', async () => {
    const { teamId, token } = await seedInvite('viewer');
    const before = await client.query('SELECT count(*)::int AS n FROM teams');

    const userId = await signUp(addr('invitee'), { invite_token: token });
    const profile = await profileOf(userId);

    expect(profile.team_id).toBe(teamId);
    expect(profile.role).toBe('viewer');

    const after = await client.query('SELECT count(*)::int AS n FROM teams');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  // The trust boundary. raw_user_meta_data is whatever the browser sent, so a
  // client that could name its own role or team_id would own every team on the
  // system. Both keys are ignored: role comes from the invite row only.
  it('ignores a role and a team_id smuggled in through signup metadata', async () => {
    const { teamId, token } = await seedInvite('viewer');
    const { rows: [victim] } = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('Victim Corp') RETURNING id`
    );

    const userId = await signUp(addr('attacker'), {
      invite_token: token,
      role: 'admin',
      team_id: victim.id,
    });
    const profile = await profileOf(userId);

    expect(profile.role).toBe('viewer');
    expect(profile.team_id).toBe(teamId);
    expect(profile.team_id).not.toBe(victim.id);
  });

  it('escalates nothing when metadata names a role with no invite at all', async () => {
    const userId = await signUp(addr('loner'), { role: 'admin', team_id: null });
    const profile = await profileOf(userId);

    // Still admin — but of a brand new team of their own, not anyone else's.
    expect(profile.role).toBe('admin');
    const { rows } = await client.query('SELECT count(*)::int AS n FROM users WHERE team_id = $1', [
      profile.team_id,
    ]);
    expect(rows[0].n).toBe(1);
  });

  for (const [label, overrides] of [
    ['unknown', null],
    ['revoked', { revoked: true }],
    ['expired', { expired: true }],
  ] as const) {
    it(`rejects a ${label} invite token and leaves no rows behind`, async () => {
      const token = overrides
        ? (await seedInvite('member', overrides)).token
        : 'z'.repeat(43);
      const email = addr(label);

      await expect(signUp(email, { invite_token: token })).rejects.toThrow(
        /invite is invalid, revoked or expired/
      );

      // The RAISE must roll back the auth.users insert too, or signup strands
      // an auth user with no profile who can log in and see nothing.
      for (const table of ['auth.users', 'users']) {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE email = $1`,
          [email]
        );
        expect(rows[0].n, `${table} should hold no row for ${email}`).toBe(0);
      }
    });
  }
});

suite('describe_invite', () => {
  let client: Client;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);
  }, 60_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  async function describeToken(token: string) {
    const { rows } = await client.query<{ team_name: string; invite_role: string }>(
      'SELECT * FROM describe_invite($1)',
      [token]
    );
    return rows;
  }

  async function seed(overrides: { revoked?: boolean; expired?: boolean } = {}) {
    const { rows: [team] } = await client.query<{ id: string }>(
      `INSERT INTO teams (name) VALUES ('Globex') RETURNING id`
    );
    const { rows: [invite] } = await client.query<{ token: string }>(
      `INSERT INTO team_invites (team_id, role, expires_at, revoked_at)
       VALUES ($1, 'member', NOW() + ($2 || ' days')::interval, $3)
       RETURNING token`,
      [team.id, overrides.expired ? '-1' : '7', overrides.revoked ? new Date() : null]
    );
    return invite.token;
  }

  it('describes a live invite', async () => {
    const rows = await describeToken(await seed());

    expect(rows).toHaveLength(1);
    expect(rows[0].team_name).toBe('Globex');
    expect(rows[0].invite_role).toBe('member');
  });

  it('returns zero rows for unknown, revoked and expired tokens alike', async () => {
    expect(await describeToken('z'.repeat(43))).toHaveLength(0);
    expect(await describeToken(await seed({ revoked: true }))).toHaveLength(0);
    expect(await describeToken(await seed({ expired: true }))).toHaveLength(0);
  });

  // The whole point of describe_invite is that a visitor with no account can
  // call it. Testing only as `postgres` would pass even if anon could not
  // execute it at all, and the invite page would silently show "link invalid"
  // to exactly the audience it exists for.
  it('is callable by anon, which still cannot read team_invites directly', async () => {
    const token = await seed();

    await client.query('SET ROLE anon');
    try {
      const { rows } = await client.query('SELECT * FROM describe_invite($1)', [token]);
      expect(rows).toHaveLength(1);
      expect(rows[0].team_name).toBe('Globex');

      // Definer rights apply inside the function only: anon's own reads of the
      // base table must still come back empty under RLS.
      const direct = await client.query('SELECT * FROM team_invites');
      expect(direct.rows).toHaveLength(0);
    } finally {
      await client.query('RESET ROLE');
    }
  });

  it('exposes only the team name and role, never the rest of the row', async () => {
    const { rows } = await client.query(
      'SELECT * FROM describe_invite($1)',
      [await seed()]
    );

    expect(Object.keys(rows[0]).sort()).toEqual(['invite_role', 'team_name']);
  });
});
