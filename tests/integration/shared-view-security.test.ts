import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { getTestClient, applySchema } from './helpers/db-setup';

const hasDb = Boolean(process.env.DATABASE_TEST_URL);
const suite = hasDb ? describe : describe.skip;

suite('Shared view security', () => {
  let client: Client;

  beforeAll(async () => {
    client = await getTestClient();
    await applySchema(client);
  }, 60_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  it('generates 43-char URL-safe tokens that do not collide', async () => {
    const { rows } = await client.query<{ token: string }>(
      'SELECT gen_share_token() AS token FROM generate_series(1, 1000)'
    );

    expect(rows).toHaveLength(1000);
    for (const { token } of rows) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(new Set(rows.map((r) => r.token)).size).toBe(1000);
  });

  /** Builds a team, monitor, one raw ping, and a saved view over it. */
  async function seedView(
    overrides: {
      revoked?: boolean;
      deletedMonitor?: boolean;
      window?: { from: string; to: string };
    } = {}
  ) {
    const { rows: [team] } = await client.query(
      `INSERT INTO teams (name) VALUES ('t') RETURNING id`
    );
    const { rows: [monitor] } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Checkout API', 'https://internal.example.test/health', 60) RETURNING id`,
      [team.id]
    );
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date();
    await client.query(
      `INSERT INTO ping_logs_raw (monitor_id, team_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3, 412, 200)`,
      [monitor.id, team.id, new Date(Date.now() - 30 * 60 * 1000)]
    );
    const { rows: [view] } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration, revoked_at)
       VALUES ($1, NULL, $2, 'Outage window', $3::jsonb, $4)
       RETURNING share_token`,
      [
        team.id,
        monitor.id,
        JSON.stringify(overrides.window ?? { from: from.toISOString(), to: to.toISOString() }),
        overrides.revoked ? new Date() : null,
      ]
    );
    if (overrides.deletedMonitor) {
      await client.query(`UPDATE monitors SET is_deleted = true WHERE id = $1`, [monitor.id]);
    }
    return { token: view.share_token as string, monitorId: monitor.id as string };
  }

  it('returns the series for a valid token', async () => {
    const { token } = await seedView();
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].monitor_name).toBe('Checkout API');
    expect(rows[0].view_name).toBe('Outage window');
  });

  it('never exposes the monitor URL', async () => {
    const { token } = await seedView();
    const { rows, fields } = await client.query('SELECT * FROM get_shared_view($1)', [token]);

    expect(fields.map((f) => f.name)).not.toContain('url');
    expect(JSON.stringify(rows)).not.toContain('internal.example.test');
  });

  it('returns nothing for a revoked token', async () => {
    const { token } = await seedView({ revoked: true });
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);
    expect(rows).toHaveLength(0);
  });

  it('returns nothing for an unknown token', async () => {
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', ['x'.repeat(43)]);
    expect(rows).toHaveLength(0);
  });

  it('returns nothing once the monitor is soft-deleted', async () => {
    const { token } = await seedView({ deletedMonitor: true });
    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);
    expect(rows).toHaveLength(0);
  });

  it('snaps an old window out to day boundaries so it is not silently empty', async () => {
    const { rows: [team] } = await client.query(`INSERT INTO teams (name) VALUES ('t2') RETURNING id`);
    const { rows: [monitor] } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Old', 'https://old.test', 60) RETURNING id`,
      [team.id]
    );
    // A daily bucket 200 days back, stamped midnight.
    const day = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    day.setUTCHours(0, 0, 0, 0);
    await client.query(
      `INSERT INTO ping_logs_daily (team_id, monitor_id, bucket_start, total_pings, successful_pings,
         avg_response_time_ms, min_response_time_ms, max_response_time_ms,
         p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3, 100, 99, 120, 40, 900, 110, 300, 800)`,
      [team.id, monitor.id, day]
    );
    // An ADJACENT day bucket (the very next midnight), distinguishable by its
    // sample count. If snapping over-widens window_to by one extra bucket
    // (the pre-fix `date_trunc('day', w_to) + INTERVAL '1 day'` behaviour),
    // this bucket leaks into the result too.
    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO ping_logs_daily (team_id, monitor_id, bucket_start, total_pings, successful_pings,
         avg_response_time_ms, min_response_time_ms, max_response_time_ms,
         p50_response_time_ms, p95_response_time_ms, p99_response_time_ms)
       VALUES ($1, $2, $3, 999, 999, 120, 40, 900, 110, 300, 800)`,
      [team.id, monitor.id, nextDay]
    );
    // A 02:00-06:00 window inside the first day matches no midnight-stamped
    // bucket unless the function widens it — but must not reach into the
    // next day's bucket either.
    const from = new Date(day); from.setUTCHours(2);
    const to = new Date(day); to.setUTCHours(6);
    const { rows: [view] } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, NULL, $2, 'Ancient', $3::jsonb) RETURNING share_token`,
      [team.id, monitor.id, JSON.stringify({ from: from.toISOString(), to: to.toISOString() })]
    );

    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [view.share_token]);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_tier).toBe('daily');
    expect(rows[0].sample_count).toBe(100);
  });

  it('as anon: get_shared_view returns rows but direct table reads return none', async () => {
    const { token } = await seedView();

    await client.query('SET ROLE anon');
    try {
      const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].monitor_name).toBe('Checkout API');

      // definer rights only bypass RLS inside get_shared_view itself — anon's
      // own SELECTs against the base tables must still be blocked by RLS
      // (there is no tenant_isolation policy granting anon anything; the
      // bootstrap-local.sql GRANTs only get anon past the privilege check, not
      // past RLS).
      const savedViews = await client.query('SELECT * FROM saved_views');
      expect(savedViews.rows).toHaveLength(0);

      const monitors = await client.query('SELECT * FROM monitors');
      expect(monitors.rows).toHaveLength(0);

      const rawPings = await client.query('SELECT * FROM ping_logs_raw');
      expect(rawPings.rows).toHaveLength(0);
    } finally {
      await client.query('RESET ROLE');
    }
  });

  it('returns nothing when a saved view points at another team\'s monitor', async () => {
    const { rows: [teamA] } = await client.query(`INSERT INTO teams (name) VALUES ('teamA') RETURNING id`);
    const { rows: [teamB] } = await client.query(`INSERT INTO teams (name) VALUES ('teamB') RETURNING id`);
    const { rows: [monitorB] } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Team B Secret Monitor', 'https://teamb.internal.test', 60) RETURNING id`,
      [teamB.id]
    );
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date();
    // A saved_views row under team A whose monitor_id points at team B's
    // monitor. Nothing on the write path stops this: RLS on saved_views only
    // constrains team_id, and ping_logs_raw/monitors have no FK tying
    // monitor_id back to the row's own team_id.
    const { rows: [view] } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, NULL, $2, 'Cross-tenant', $3::jsonb) RETURNING share_token`,
      [teamA.id, monitorB.id, JSON.stringify({ from: from.toISOString(), to: to.toISOString() })]
    );
    // Plant a ping row team A could genuinely write itself: RLS on
    // ping_logs_raw checks only team_id, and the column has no FK, so a team A
    // member can tag team_id = teamA against ANY monitor_id, including team
    // B's. This reproduces the actual exploit shape: without the join's team
    // check, get_shared_view would find team B's monitor by id, then
    // select_ping_tier_for_team(teamA, monitorB, ...) would happily match this
    // planted row and leak team B's monitor name/status alongside it.
    await client.query(
      `INSERT INTO ping_logs_raw (monitor_id, team_id, timestamp, response_time_ms, status_code)
       VALUES ($1, $2, $3, 111, 200)`,
      [monitorB.id, teamA.id, new Date(Date.now() - 30 * 60 * 1000)]
    );

    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [view.share_token]);
    expect(rows).toHaveLength(0);
  });

  it('returns the view header, and no data points, for a valid token whose window is empty', async () => {
    // The same fixture as every other case — a monitor that does have a ping —
    // but pinned to a window far away from it, so the emptiness comes from the
    // window and not from a bare monitor. Before this change the function
    // returned zero rows here, indistinguishable from an unknown token, and the
    // page 404'd a link that was perfectly valid.
    const { token } = await seedView({
      window: { from: '2019-01-01T00:00:00Z', to: '2019-01-01T04:00:00Z' },
    });

    const { rows } = await client.query('SELECT * FROM get_shared_view($1)', [token]);

    expect(rows).toHaveLength(1);
    expect(rows[0].view_name).toBe('Outage window');
    expect(rows[0].monitor_name).toBe('Checkout API');
    expect(rows[0].window_from).not.toBeNull();
    expect(rows[0].window_to).not.toBeNull();
    // The series columns are null — there is no point to describe.
    expect(rows[0].ts).toBeNull();
    expect(rows[0].response_time_ms).toBeNull();
    expect(rows[0].source_tier).toBeNull();
    // And the redaction still holds.
    expect(Object.keys(rows[0])).not.toContain('url');
  });

  it('returns nothing for a saved view with a malformed window instead of leaking an error', async () => {
    const { rows: [team] } = await client.query(`INSERT INTO teams (name) VALUES ('t3') RETURNING id`);
    const { rows: [monitor] } = await client.query(
      `INSERT INTO monitors (team_id, name, url, check_interval)
       VALUES ($1, 'Bad Config', 'https://bad.test', 60) RETURNING id`,
      [team.id]
    );
    const { rows: [view] } = await client.query(
      `INSERT INTO saved_views (team_id, creator_id, monitor_id, name, configuration)
       VALUES ($1, NULL, $2, 'Malformed', $3::jsonb) RETURNING share_token`,
      [team.id, monitor.id, JSON.stringify({ from: 'not-a-date', to: 'also-not-a-date' })]
    );

    await expect(
      client.query('SELECT * FROM get_shared_view($1)', [view.share_token])
    ).resolves.toMatchObject({ rows: [] });
  });
});
