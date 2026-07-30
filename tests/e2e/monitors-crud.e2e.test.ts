import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/api/server';
import { db } from '../../src/api/db';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { apiConfig } from '../../src/api/config/api-config';

describe('Monitors CRUD E2E', () => {
  const app = createServer();
  let authHeaders: { Authorization: string };
  let teamId = '0190a3c2-d3b2-70b3-9e45-1b2a3c4d5eee';
  let userId = '0190a3c2-d3b2-70b3-9e45-1b2a3c4d5eef';
  let monitorId: string;

  beforeAll(async () => {
    // Insert Teams
    await db.query(`INSERT INTO teams (id, name, plan, created_at, updated_at) VALUES ($1, $2, 'free', NOW(), NOW()) ON CONFLICT DO NOTHING`, [teamId, 'CRUD E2E Team']);

    // Insert Users
    const hashed = await bcrypt.hash('password123', 10);
    await db.query(`INSERT INTO users (id, team_id, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) ON CONFLICT (email) DO NOTHING`, [userId, teamId, 'crud@example.com', hashed, 'admin']);

    const token = jwt.sign({ userId, teamId, role: 'admin' }, apiConfig.JWT_SECRET, { expiresIn: '15m' });
    authHeaders = { Authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    // Clean up created monitors
    if (monitorId) {
      await db.query(`DELETE FROM monitors WHERE id = $1`, [monitorId]);
    }
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    await db.query('DELETE FROM teams WHERE id = $1', [teamId]);
    await db.end();
  });

  it('creates a monitor successfully', async () => {
    const res = await request(app)
      .post('/api/monitors')
      .set(authHeaders)
      .send({
        name: 'E2E Test Monitor',
        url: 'https://example.com/e2e',
        http_method: 'GET',
        expected_status: 200,
        check_interval: 60
      });

    if (res.status === 500) console.log(res.body);

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.name).toBe('E2E Test Monitor');
    
    monitorId = res.body.data.id;
  });

  it('retrieves the created monitor', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitorId}`)
      .set(authHeaders);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(monitorId);
    expect(res.body.url).toBe('https://example.com/e2e');
  });

  it('updates the monitor', async () => {
    const res = await request(app)
      .patch(`/api/monitors/${monitorId}`)
      .set(authHeaders)
      .send({
        name: 'Updated E2E Monitor'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated E2E Monitor');
  });

  it('lists monitors', async () => {
    const res = await request(app)
      .get('/api/monitors')
      .set(authHeaders);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const monitor = res.body.find((m: any) => m.id === monitorId);
    expect(monitor).toBeDefined();
  });

  it('deletes the monitor', async () => {
    const deleteRes = await request(app)
      .delete(`/api/monitors/${monitorId}`)
      .set(authHeaders);

    expect(deleteRes.status).toBe(204);

    const getRes = await request(app)
      .get(`/api/monitors/${monitorId}`)
      .set(authHeaders);

    expect(getRes.status).toBe(404);
  });
});
