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
});
