import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';

const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

/**
 * Impersonates a PostgREST request. The local harness stubs auth.uid() as a read
 * of `request.jwt.claim.sub` (tests/integration/helpers/bootstrap-local.sql), so
 * the claim must be set BEFORE the SET ROLE: once the session is `anon` or
 * `authenticated` it no longer owns the setting it is about to need.
 */
async function asRole(
  client: Client,
  role: 'anon' | 'authenticated',
  userId?: string
): Promise<void> {
  await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  await client.query(`SET ROLE ${role}`);
}

async function resetRole(client: Client): Promise<void> {
  await client.query('RESET ROLE');
  await client.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
}

suite('Role-aware row level security', () => {
  let client: Client;
  let teamId: string;
  let adminId: string;
  let memberId: string;
  let viewerId: string;
  let monitorId: string;
  let viewId: string;
  let otherTeamId: string;
  let otherAdminId: string;

  /**
   * Signs a brand new user up through the real auth trigger. With no token the
   * trigger creates a team and makes the caller its admin; with one it joins the
   * invite's team at the invite's role. Going through handle_new_user() rather
   * than inserting public.users directly keeps the fixture honest about how roles
   * are actually assigned.
   */
  async function signUp(meta: Record<string, string>): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3::jsonb)`,
      [id, `${id}@roles.test`, JSON.stringify(meta)]
    );
    return id;
  }

  /** An admin-created invite for `role`, returned as its token. */
  async function invite(role: string): Promise<string> {
    const { rows } = await client.query(
      `INSERT INTO team_invites (team_id, creator_id, role, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days') RETURNING token`,
      [teamId, adminId, role]
    );
    return rows[0].token as string;
  }

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);

    adminId = await signUp({ team_name: 'Roles team' });
    ({
      rows: [{ team_id: teamId }],
    } = await client.query('SELECT team_id FROM users WHERE id = $1', [adminId]));
    memberId = await signUp({ invite_token: await invite('member') });
    viewerId = await signUp({ invite_token: await invite('viewer') });

    otherAdminId = await signUp({ team_name: 'Other team' });
    ({
      rows: [{ team_id: otherTeamId }],
    } = await client.query('SELECT team_id FROM users WHERE id = $1', [otherAdminId]));

    ({
      rows: [{ id: monitorId }],
    } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Seeded', 'https://seed.example.test/health', 60) RETURNING id`,
      [teamId]
    ));
    await client.query(
      `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, NOW(), 120, 200)`,
      [teamId, monitorId]
    );
    ({
      rows: [{ id: viewId }],
    } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, $2, $3, 'Seeded view', '{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}'::jsonb)
       RETURNING id`,
      [teamId, adminId, monitorId]
    ));
    await client.query(
      `INSERT INTO team_webhooks (team_id, provider, url)
       VALUES ($1, 'slack', 'https://hooks.example.test/seed')`,
      [teamId]
    );
  }, 60_000);

  afterEach(async () => {
    if (client) await resetRole(client);
  });

  afterAll(async () => {
    if (client) {
      // Seven test files share this database and the next run of this one must
      // find no partition of its own left behind, for the reason in
      // createPartition() above.
      for (const partition of createdPartitions) {
        await client.query(`DROP TABLE IF EXISTS ${partition}`);
      }
      await client.end();
    }
  });

  // -------------------------------------------------------------------------
  // current_user_role() and the grant floor
  // -------------------------------------------------------------------------

  it('current_user_role returns the caller own role', async () => {
    await asRole(client, 'authenticated', viewerId);
    const { rows } = await client.query('SELECT current_user_role() AS role');
    expect(rows[0].role).toBe('viewer');
  });

  it('anon cannot execute current_user_role', async () => {
    await asRole(client, 'anon');
    await expect(client.query('SELECT current_user_role()')).rejects.toThrow(/permission denied/i);
  });

  it('authenticated cannot write ping_logs_raw but can still read it', async () => {
    await asRole(client, 'authenticated', memberId);
    await expect(
      client.query(
        `INSERT INTO ping_logs_raw (team_id, monitor_id, timestamp, response_time_ms, status_code)
         VALUES ($1, $2, NOW(), 100, 200)`,
        [teamId, monitorId]
      )
    ).rejects.toThrow(/permission denied/i);
    const read = await client.query('SELECT * FROM ping_logs_raw');
    expect(read.rows.length).toBeGreaterThan(0);
  });

  it('authenticated cannot write teams or users', async () => {
    await asRole(client, 'authenticated', adminId);
    await expect(client.query(`UPDATE teams SET name = 'hijacked'`)).rejects.toThrow(
      /permission denied/i
    );
    await expect(client.query(`UPDATE users SET role = 'admin'`)).rejects.toThrow(
      /permission denied/i
    );
  });

  it('authenticated has no access at all to rollup_logs or deletion_queue', async () => {
    await asRole(client, 'authenticated', adminId);
    await expect(client.query('SELECT * FROM rollup_logs')).rejects.toThrow(/permission denied/i);
    await expect(client.query('SELECT * FROM deletion_queue')).rejects.toThrow(
      /permission denied/i
    );
  });

  it('admin cannot rewrite a share token but can still revoke the view', async () => {
    // Its own view, not the shared `viewId`. This test revokes the row it acts
    // on, and if the rowCount assertion below ever fails the revocation would
    // stay behind and break `get_shared_view still serves anon` further down,
    // sending the next reader to the wrong test.
    const {
      rows: [own],
    } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, $2, $3, 'Revocable view', '{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}'::jsonb)
       RETURNING id`,
      [teamId, adminId, monitorId]
    );

    await asRole(client, 'authenticated', adminId);
    await expect(
      client.query(`UPDATE saved_views SET share_token = $1 WHERE id = $2`, [randomUUID(), own.id])
    ).rejects.toThrow(/permission denied/i);
    const revoke = await client.query(`UPDATE saved_views SET revoked_at = NOW() WHERE id = $1`, [
      own.id,
    ]);
    expect(revoke.rowCount).toBe(1);
  });

  describe('revocation is the only update, and it is one way', () => {
    const CONFIG = `'{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}'::jsonb`;

    /** A fresh row per test, inserted as the table owner so no grant or policy is in the way. */
    async function freshView(revoked = false): Promise<string> {
      const {
        rows: [row],
      } = await client.query(
        `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration, revoked_at)
         VALUES ($1, $2, $3, 'One way view', ${CONFIG}, ${revoked ? 'NOW()' : 'NULL'}) RETURNING id`,
        [teamId, adminId, monitorId]
      );
      return row.id;
    }
    async function freshInvite(revoked = false): Promise<string> {
      const {
        rows: [row],
      } = await client.query(
        `INSERT INTO team_invites (team_id, creator_id, role, expires_at, revoked_at)
         VALUES ($1, $2, 'viewer', NOW() + INTERVAL '1 day', ${revoked ? 'NOW()' : 'NULL'}) RETURNING id`,
        [teamId, adminId]
      );
      return row.id;
    }
    const revokedAt = async (table: string, id: string) =>
      (await client.query(`SELECT revoked_at FROM ${table} WHERE id = $1`, [id])).rows[0].revoked_at;

    it.each([
      ['saved_views', freshView],
      ['team_invites', freshInvite],
    ])('revoking a live %s row works', async (table, make) => {
      const id = await make();
      await asRole(client, 'authenticated', adminId);
      const res = await client.query(
        `UPDATE ${table} SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
        [id]
      );
      expect(res.rowCount).toBe(1);
      await resetRole(client);
      expect(await revokedAt(table, id)).not.toBeNull();
    });

    it.each([
      ['saved_views', freshView],
      ['team_invites', freshInvite],
    ])('a second revoke of an already revoked %s row changes nothing', async (table, make) => {
      const id = await make(true);
      const before = await revokedAt(table, id);
      await asRole(client, 'authenticated', adminId);
      const res = await client.query(
        `UPDATE ${table} SET revoked_at = NOW() + INTERVAL '1 hour' WHERE id = $1 AND revoked_at IS NULL`,
        [id]
      );
      expect(res.rowCount).toBe(0);
      await resetRole(client);
      expect(await revokedAt(table, id)).toEqual(before);
    });

    it.each([
      ['saved_views', freshView],
      ['team_invites', freshInvite],
    ])('un-revoking a %s row is refused by row level security', async (table, make) => {
      const id = await make(true);
      await asRole(client, 'authenticated', adminId);
      await expect(
        client.query(`UPDATE ${table} SET revoked_at = NULL WHERE id = $1`, [id])
      ).rejects.toThrow(/row-level security/i);
      await resetRole(client);
      expect(await revokedAt(table, id)).not.toBeNull();
    });

    it('a saved view name and creator cannot be rewritten', async () => {
      const id = await freshView();
      await asRole(client, 'authenticated', adminId);
      await expect(
        client.query(`UPDATE saved_views SET name = 'renamed' WHERE id = $1`, [id])
      ).rejects.toThrow(/permission denied/i);
      await expect(
        client.query(`UPDATE saved_views SET creator_id = $1 WHERE id = $2`, [memberId, id])
      ).rejects.toThrow(/permission denied/i);
    });

    it('a minted invite role and expiry cannot be changed', async () => {
      const id = await freshInvite();
      await asRole(client, 'authenticated', adminId);
      await expect(
        client.query(`UPDATE team_invites SET role = 'admin' WHERE id = $1`, [id])
      ).rejects.toThrow(/permission denied/i);
      await expect(
        client.query(`UPDATE team_invites SET expires_at = NOW() + INTERVAL '10 years' WHERE id = $1`, [id])
      ).rejects.toThrow(/permission denied/i);
    });

    // Frozen on purpose. A column added to either table is unwritable through
    // the API until someone decides otherwise: add it to the UPDATE grant in the
    // migration, or add it here to say it stays read-only. Making that choice
    // consciously is the point of this test.
    const FROZEN_COLUMNS: Record<string, string[]> = {
      saved_views: ['configuration', 'created_at', 'creator_id', 'id', 'monitor_id', 'name', 'revoked_at', 'share_token', 'team_id', 'updated_at'],
      team_invites: ['created_at', 'creator_id', 'expires_at', 'id', 'revoked_at', 'role', 'team_id', 'token'],
    };

    it.each(Object.keys(FROZEN_COLUMNS))('%s columns are frozen and only revoked_at is updatable', async (table) => {
      const { rows } = await client.query(
        `SELECT column_name,
                has_column_privilege('authenticated', format('public.%I', table_name), column_name, 'UPDATE') AS updatable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY column_name`,
        [table]
      );
      expect(rows.map((r) => r.column_name)).toEqual(FROZEN_COLUMNS[table]);
      expect(rows.filter((r) => r.updatable).map((r) => r.column_name)).toEqual(['revoked_at']);
    });
  });

  it('a client cannot choose a saved view share token', async () => {
    await asRole(client, 'authenticated', adminId);
    await expect(
      client.query(
        `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration, share_token)
         VALUES ($1, $2, $3, 'chosen token', '{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}'::jsonb, 'guessable')`,
        [teamId, adminId, monitorId]
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('a client cannot choose a team invite token', async () => {
    await asRole(client, 'authenticated', adminId);
    await expect(
      client.query(
        `INSERT INTO team_invites (team_id, creator_id, role, expires_at, token)
         VALUES ($1, $2, 'admin', NOW() + INTERVAL '1 day', 'guessable')`,
        [teamId, adminId]
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('omitting the token column still inserts, with the generated secret', async () => {
    await asRole(client, 'authenticated', adminId);
    const view = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, $2, $3, 'generated token', '{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}'::jsonb)
       RETURNING share_token`,
      [teamId, adminId, monitorId]
    );
    expect(view.rows[0].share_token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const inv = await client.query(
      `INSERT INTO team_invites (team_id, creator_id, role, expires_at)
       VALUES ($1, $2, 'member', NOW() + INTERVAL '1 day') RETURNING token`,
      [teamId, adminId]
    );
    expect(inv.rows[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  // -------------------------------------------------------------------------
  // The role matrix
  // -------------------------------------------------------------------------

  it('member can create a monitor, viewer cannot', async () => {
    await asRole(client, 'authenticated', memberId);
    const created = await client.query(
      `INSERT INTO monitors (name, url, check_interval)
       VALUES ('member made', 'https://member.example.test/health', 60) RETURNING team_id`
    );
    expect(created.rows[0].team_id).toBe(teamId);

    await resetRole(client);
    await asRole(client, 'authenticated', viewerId);
    await expect(
      client.query(
        `INSERT INTO monitors (name, url, check_interval)
         VALUES ('viewer made', 'https://viewer.example.test/health', 60)`
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('viewer cannot update or delete a monitor, member can', async () => {
    await asRole(client, 'authenticated', viewerId);
    const viewerUpdate = await client.query(`UPDATE monitors SET is_paused = true WHERE id = $1`, [
      monitorId,
    ]);
    expect(viewerUpdate.rowCount).toBe(0);
    const viewerDelete = await client.query(`DELETE FROM monitors WHERE id = $1`, [monitorId]);
    expect(viewerDelete.rowCount).toBe(0);

    await resetRole(client);
    await asRole(client, 'authenticated', memberId);
    const memberUpdate = await client.query(`UPDATE monitors SET is_paused = true WHERE id = $1`, [
      monitorId,
    ]);
    expect(memberUpdate.rowCount).toBe(1);
  });

  it('member can create a saved view, viewer cannot', async () => {
    await asRole(client, 'authenticated', memberId);
    const created = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, $2, $3, 'member view', '{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}'::jsonb)
       RETURNING id`,
      [teamId, memberId, monitorId]
    );
    expect(created.rows).toHaveLength(1);

    await resetRole(client);
    await asRole(client, 'authenticated', viewerId);
    await expect(
      client.query(
        `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
         VALUES ($1, $2, $3, 'viewer view', '{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}'::jsonb)`,
        [teamId, viewerId, monitorId]
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('only admin can select team_webhooks', async () => {
    await asRole(client, 'authenticated', adminId);
    const admin = await client.query('SELECT * FROM team_webhooks');
    expect(admin.rows.length).toBeGreaterThan(0);

    for (const userId of [memberId, viewerId]) {
      await resetRole(client);
      await asRole(client, 'authenticated', userId);
      const { rows } = await client.query('SELECT * FROM team_webhooks');
      expect(rows).toHaveLength(0);
    }
  });

  it('only admin can insert team_webhooks', async () => {
    await asRole(client, 'authenticated', adminId);
    const created = await client.query(
      `INSERT INTO team_webhooks (team_id, provider, url)
       VALUES ($1, 'discord', 'https://hooks.example.test/admin') RETURNING id`,
      [teamId]
    );
    expect(created.rows).toHaveLength(1);

    for (const userId of [memberId, viewerId]) {
      await resetRole(client);
      await asRole(client, 'authenticated', userId);
      await expect(
        client.query(
          `INSERT INTO team_webhooks (team_id, provider, url)
           VALUES ($1, 'discord', 'https://hooks.example.test/nope')`,
          [teamId]
        )
      ).rejects.toThrow(/row-level security/i);
    }
  });

  it('only admin can select team_invites', async () => {
    await asRole(client, 'authenticated', adminId);
    const admin = await client.query('SELECT * FROM team_invites');
    expect(admin.rows.length).toBeGreaterThan(0);

    for (const userId of [memberId, viewerId]) {
      await resetRole(client);
      await asRole(client, 'authenticated', userId);
      const { rows } = await client.query('SELECT * FROM team_invites');
      expect(rows).toHaveLength(0);
    }
  });

  it('only admin can insert team_invites', async () => {
    await asRole(client, 'authenticated', adminId);
    const created = await client.query(
      `INSERT INTO team_invites (team_id, creator_id, role, expires_at)
       VALUES ($1, $2, 'member', NOW() + INTERVAL '1 day') RETURNING id`,
      [teamId, adminId]
    );
    expect(created.rows).toHaveLength(1);

    for (const userId of [memberId, viewerId]) {
      await resetRole(client);
      await asRole(client, 'authenticated', userId);
      await expect(
        client.query(
          `INSERT INTO team_invites (team_id, creator_id, role, expires_at)
           VALUES ($1, $2, 'admin', NOW() + INTERVAL '1 day')`,
          [teamId, userId]
        )
      ).rejects.toThrow(/row-level security/i);
    }
  });

  it('no role can update users.role through the api', async () => {
    for (const userId of [adminId, memberId, viewerId]) {
      await resetRole(client);
      await asRole(client, 'authenticated', userId);
      await expect(
        client.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId])
      ).rejects.toThrow(/permission denied/i);
    }
    await resetRole(client);
    const { rows } = await client.query('SELECT role FROM users WHERE id = $1', [viewerId]);
    expect(rows[0].role).toBe('viewer');
  });

  /**
   * A session with no row in `users` reads nothing and writes nothing. The
   * denial comes from the tenant predicate: current_team_id() is NULL, so
   * `team_id = current_team_id()` is NULL, which is not true, which denies,
   * before the role conjunct is reached.
   *
   * This test does NOT prove that a NULL role denies, and no test can while
   * `users.role` is NOT NULL (schema.sql:33). A missing profile row is the only
   * way current_user_role() returns NULL, and that same row's absence already
   * makes current_team_id() NULL, so the two conjuncts cannot be told apart.
   * The policies are still written `current_user_role() IN ('admin','member')`
   * rather than `<> 'viewer'`, for readability and for the day `role` becomes
   * nullable or a profile row exists without a team, but that is a choice this
   * suite does not observe. The matching report section says the same.
   */
  it('a session with no profile row is denied by the tenant predicate', async () => {
    await asRole(client, 'authenticated', randomUUID());
    const { rows } = await client.query('SELECT * FROM monitors');
    expect(rows).toHaveLength(0);
    // A pattern, not a bare toThrow: that would also be satisfied by a NOT NULL
    // violation or a typo in the statement, so it would not pin the mechanism.
    await expect(
      client.query(
        `INSERT INTO monitors (team_id, name, url, check_interval)
         VALUES ($1, 'x', 'https://e.test', 60)`,
        [teamId]
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('viewer can read everything its team owns', async () => {
    await asRole(client, 'authenticated', viewerId);
    for (const table of ['monitors', 'saved_views', 'ping_logs_raw', 'users', 'teams']) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n, `viewer sees no rows in ${table}`).toBeGreaterThan(0);
    }
  });

  it('cross tenant isolation still holds after the rewrite', async () => {
    await asRole(client, 'authenticated', otherAdminId);
    for (const table of ['monitors', 'saved_views', 'team_webhooks', 'team_invites', 'users']) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE team_id = $1`,
        [teamId]
      );
      expect(rows[0].n, `${table} leaked rows from the other team`).toBe(0);
    }
    const { rows: teamRows } = await client.query('SELECT id FROM teams');
    expect(teamRows.map((r) => r.id)).toEqual([otherTeamId]);
  });

  it('get_shared_view still serves anon after the rewrite', async () => {
    const {
      rows: [view],
    } = await client.query(`SELECT share_token FROM saved_views WHERE id = $1`, [viewId]);
    await asRole(client, 'anon');
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [view.share_token]);
    expect(rows.length).toBeGreaterThan(0);
  });
  // -------------------------------------------------------------------------
  // Partitions created after the migration
  //
  // create_daily_partition() runs as `postgres` from pg_cron at 03:00 and makes
  // tomorrow's ping_logs_raw partition. A revoke that only covered the
  // partitions existing when the migration ran would stop protecting anything
  // overnight, so the guard has to apply to a partition created afterwards.
  // -------------------------------------------------------------------------

  /** The partition create_daily_partition() makes for `day`. */
  function partitionFor(day: string): string {
    return `ping_logs_raw_${day.replace(/-/g, '')}`;
  }

  /**
   * A day far enough out that no partition for it exists yet. schema.sql:379
   * pre-creates CURRENT_DATE - 7 through CURRENT_DATE + 30, and
   * create_daily_partition() is CREATE TABLE IF NOT EXISTS, so anything inside
   * that window is an existing table and these tests would assert on the
   * migration's sweep of existing partitions instead of on a partition created
   * after the migration ran, which is the whole point.
   */
  function freshDay(offset: number): string {
    return new Date(Date.now() + (40 + offset) * 86_400_000).toISOString().slice(0, 10);
  }

  /** Partitions these tests created, dropped in afterAll. */
  const createdPartitions: string[] = [];

  /**
   * Creates the partition for `day` and returns its name, dropping any table of
   * that name first.
   *
   * The DROP is what makes these tests falsifiable. db-setup.ts:108-110 reuses
   * an existing database and skips schema.sql when `monitors` is already there,
   * which is the documented dev loop, and create_daily_partition() is
   * CREATE TABLE IF NOT EXISTS. So without the DROP, a second run on the same
   * day finds the partition the previous run left behind, the CREATE no-ops, and
   * every assertion below reads grants the previous run had already revoked:
   * green with the revoke inside create_daily_partition() deleted.
   */
  async function createPartition(day: string): Promise<string> {
    const partition = partitionFor(day);
    await client.query(`DROP TABLE IF EXISTS ${partition}`);
    await client.query('SELECT create_daily_partition($1::date)', [day]);
    createdPartitions.push(partition);
    return partition;
  }

  it('a partition created after the migration is not writable by authenticated', async () => {
    const day = freshDay(0);
    const partition = await createPartition(day);
    await asRole(client, 'authenticated', memberId);
    // A row that is valid for the partition and for its range, so the only
    // thing left to reject it is the grant. With the grant in place this fails
    // on row level security instead, which is a different message and does not
    // satisfy the matcher: a privilege check runs before any policy does.
    await expect(
      client.query(
        `INSERT INTO ${partition} (team_id, monitor_id, timestamp, response_time_ms, status_code)
         VALUES ($1, $2, $3::date + INTERVAL '1 hour', 120, 200)`,
        [teamId, monitorId, day]
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('a partition created after the migration grants authenticated SELECT and nothing else', async () => {
    const day = freshDay(1);
    const partition = await createPartition(day);
    // Asked of the catalog rather than inferred from a failing statement: a
    // narrower grant sitting beside a wider one is not an error in SQL, and
    // only the catalog says which one actually applied. MAINTAIN is in the list
    // because Supabase's provisioning defaults grant it on PostgreSQL 17 and
    // the earlier revoke did not name it.
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        const { rows } = await client.query(
          `SELECT has_table_privilege($1, $2, $3) AS held`,
          [role, partition, priv]
        );
        expect(rows[0].held, `${role} still holds ${priv} on the new partition`).toBe(false);
      }
      const { rows } = await client.query(`SELECT has_table_privilege($1, $2, 'SELECT') AS held`, [
        role,
        partition,
      ]);
      expect(rows[0].held, `${role} lost SELECT on the new partition`).toBe(true);
    }
  });

  /**
   * And the catch-all, pinned on its own: the default privileges cover every
   * table created in `public` from here on, not only a partition. Without this
   * the next migration that adds a table ships it writable by `authenticated`,
   * the same way the partitions were, and no other test in this file notices.
   *
   * Declared before the test below on purpose: that one grants the default
   * privileges back and revokes them again in its finally, so this probe placed
   * after it would pass on that cleanup rather than on the migration. The
   * precondition is asserted rather than trusted, so a reorder or a future
   * shuffle fails loudly here instead of leaving this test green and vacuous.
   */
  it('a table created after the migration is not writable by anon or authenticated', async () => {
    const { rows: acl } = await client.query(
      `SELECT coalesce(array_to_string(defaclacl, ','), '') AS acl
         FROM pg_default_acl
        WHERE defaclnamespace = 'public'::regnamespace
          AND defaclobjtype = 'r'
          AND defaclrole = 'postgres'::regrole`
    );
    expect(
      acl.map((r) => r.acl).join('|'),
      'precondition: the default privileges for role postgres must be the ones the migration left, ' +
        'or this test proves nothing about the migration. If this fails, something ran before it ' +
        'and changed them'
    ).toBe('anon=r/postgres,authenticated=r/postgres');
    await client.query('CREATE TABLE grant_default_probe (id INTEGER)');
    try {
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
          const { rows } = await client.query(`SELECT has_table_privilege($1, 'grant_default_probe', $2) AS held`, [
            role,
            priv,
          ]);
          expect(rows[0].held, `${role} holds ${priv} on a table created after the migration`).toBe(false);
        }
      }
    } finally {
      await client.query('DROP TABLE grant_default_probe');
    }
  });

  /**
   * The two defences in the migration both produce the state the test above
   * asserts, so that test alone does not say which one is working: removing
   * either one leaves it passing. This one isolates the revoke inside
   * create_daily_partition() by first putting the schema's default privileges
   * back the way Supabase provisions them, so the catch-all defence is absent
   * and only the function's own REVOKE can produce the result.
   */
  it('the revoke inside create_daily_partition holds when the default privileges grant writes', async () => {
    const day = freshDay(2);
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
         GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated`
    );
    try {
      const partition = await createPartition(day);
      for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        const { rows } = await client.query(
          `SELECT has_table_privilege('authenticated', $1, $2) AS held`,
          [partition, priv]
        );
        expect(rows[0].held, `authenticated holds ${priv} on a partition made under granting defaults`).toBe(
          false
        );
      }
    } finally {
      // The database is shared by seven test files, and every table created
      // after this point would otherwise carry the grants back.
      await client.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
           REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated`
      );
    }
  });

  it('authenticated holds no MAINTAIN on the existing tables', async () => {
    for (const table of ['ping_logs_raw', 'monitors', 'users', 'teams', 'saved_views']) {
      const { rows } = await client.query(
        `SELECT has_table_privilege('authenticated', $1, 'MAINTAIN') AS held`,
        [table]
      );
      expect(rows[0].held, `authenticated still holds MAINTAIN on ${table}`).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Function execute grants
  //
  // Functions are executable by PUBLIC the moment they are created, and
  // PostgREST publishes every one of them under /rest/v1/rpc/. The ACL entry
  // that matters is the one with an empty grantee, so a revoke naming only
  // `anon` and `authenticated` leaves the PUBLIC grant behind and changes
  // nothing. current_team_id() is the opposite hazard: every RLS policy in the
  // schema calls it and a policy expression evaluates as the querying role, so
  // the revoke has to be followed by a re-grant to `authenticated` or the whole
  // application loses every query.
  // -------------------------------------------------------------------------

  it('anon cannot call enqueue_monitor_purge', async () => {
    await asRole(client, 'anon');
    await expect(client.query('SELECT enqueue_monitor_purge()')).rejects.toThrow(
      /permission denied/i
    );
  });

  it('anon cannot call current_team_id', async () => {
    await asRole(client, 'anon');
    await expect(client.query('SELECT current_team_id()')).rejects.toThrow(/permission denied/i);
  });

  it('authenticated can still run every policy, so current_team_id stays executable', async () => {
    await asRole(client, 'authenticated', memberId);
    const { rows } = await client.query('SELECT * FROM monitors');
    expect(rows.length).toBeGreaterThan(0);
  });

  /**
   * Postgres checks EXECUTE on a trigger function when the trigger is created,
   * not each time it fires, which is why enqueue_monitor_purge() can lose its
   * grant and keep working. Asserted rather than assumed: this is the one place
   * the revoke could have caused a silent data loss, because a monitor whose
   * purge never enqueues keeps its ping logs forever.
   */
  it('the soft delete trigger still fires after the revoke', async () => {
    const {
      rows: [doomed],
    } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Soft deleted', 'https://purge.example.test/health', 60) RETURNING id`,
      [teamId]
    );

    try {
      await asRole(client, 'authenticated', adminId);
      const update = await client.query(`UPDATE monitors SET is_deleted = true WHERE id = $1`, [
        doomed.id,
      ]);
      expect(update.rowCount).toBe(1);

      // deletion_queue is readable by `postgres` only, so the check cannot be
      // made from inside the impersonated session that caused the write.
      await resetRole(client);
      const { rows } = await client.query(
        `SELECT status FROM deletion_queue WHERE monitor_id = $1`,
        [doomed.id]
      );
      expect(rows, 'the soft delete enqueued no purge').toHaveLength(1);
      expect(rows[0].status).toBe('pending');
    } finally {
      // This is the only test here that leaves rows behind, and the queue row
      // has to go before the monitor it references. Neither affects another
      // assertion in this file, but a soft-deleted monitor and a pending purge
      // are exactly the fixtures a later test about either would trip over.
      await resetRole(client);
      await client.query('DELETE FROM deletion_queue WHERE monitor_id = $1', [doomed.id]);
      await client.query('DELETE FROM monitors WHERE id = $1', [doomed.id]);
    }
  });

  /**
   * The invariant: every function in `public` names pg_temp in its search_path.
   *
   * An unpinned function resolves its unqualified names through whatever the
   * caller's search_path says, and pg_temp sits at the front of that path, so a
   * caller can shadow any relation the body reads with a temp table of the same
   * name. Naming pg_temp explicitly is what fixes its position. That reasoning
   * does not depend on SECURITY DEFINER: definer only changes how bad the
   * consequence is, from a function that returns the caller's own planted rows
   * to a privilege escalation. So the assertion covers every function, not a
   * class of them.
   *
   * It is load bearing for invoker functions too, which is why they are not
   * carved out. create_daily_partition builds DDL with format() over
   * unqualified names, and gen_share_token resolves pgcrypto through its path.
   *
   * There is no exception list because no function in `public` needs one: all
   * twelve pin it today. If a future function genuinely cannot, name it here
   * with the reason rather than narrowing the selection, because an exception a
   * reader can see is the point and a filter that hides one is the bug below.
   *
   * Selection is by what the function IS, and the pin is asserted afterwards.
   * Filtering on `proconfig IS NOT NULL` instead would be the bug this test
   * exists to catch: a replacement that drops the SET clause entirely leaves
   * proconfig NULL, which such a filter removes from the result set, so the
   * worst case (a function with no pin at all) would pass unnoticed. That
   * filter's row count shrinks by exactly the function that just broke.
   *
   * prokind = 'f' is plain functions. Procedures, aggregates and window
   * functions would each need their own reasoning and the schema has none, so
   * one appearing should be looked at rather than silently asserted about.
   */
  it('every function in public pins pg_temp in its search_path', async () => {
    const { rows } = await client.query(`
      SELECT p.proname, p.proconfig FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'`);
    expect(rows.length, 'no function matched, so this test asserts nothing').toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.proconfig, `${r.proname} pins no search_path at all`).not.toBeNull();
      expect(r.proconfig.join(','), r.proname).toContain('pg_temp');
    }
  });

  /**
   * The positive case is the one that matters for this function. It is
   * SECURITY DEFINER and the advisor flags it, but `anon` reaching it is the
   * point: register-form.tsx:32 calls it over RPC from the browser to name the
   * team on an invite link, before the visitor has an account at all. So the
   * migration narrows an inherited PUBLIC grant into a deliberate one and must
   * leave the anonymous path working.
   */
  it('anon can still call describe_invite, which the register page needs', async () => {
    const token = await invite('member');
    await asRole(client, 'anon');
    const { rows } = await client.query('SELECT * FROM describe_invite($1)', [token]);
    expect(rows).toHaveLength(1);
    expect(rows[0].team_name).toBe('Roles team');
    expect(rows[0].invite_role).toBe('member');
  });

  /**
   * Asked of the catalog, because a behavioural test cannot tell an inherited
   * PUBLIC grant from a deliberate one: both let the call through, and the
   * posture is the whole difference. aclexplode reports PUBLIC as grantee 0.
   *
   * A NULL proacl is checked separately and is the trap this test exists for:
   * aclexplode(NULL) yields no rows, so the grantee probe alone would call a
   * function with the default ACL clean when PUBLIC in fact holds EXECUTE on it
   * implicitly. That is exactly the state describe_invite was in.
   */
  it('no function this migration settled is executable by PUBLIC', async () => {
    const { rows } = await client.query(`
      SELECT p.proname,
             p.proacl IS NULL AS inherited_default,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_holds
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('current_team_id', 'enqueue_monitor_purge', 'describe_invite')
       ORDER BY p.proname`);
    expect(rows.map((r) => r.proname)).toEqual([
      'current_team_id',
      'describe_invite',
      'enqueue_monitor_purge',
    ]);
    for (const r of rows) {
      expect(r.inherited_default, `${r.proname} still carries the default ACL, so PUBLIC holds EXECUTE on it`).toBe(
        false
      );
      expect(r.public_holds, `${r.proname} grants EXECUTE to PUBLIC`).toBe(false);
    }
  });
});
