import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/api/server';
import { db } from '../../src/api/db';
import bcrypt from 'bcrypt';

const app = createServer();

describe('Auth API (E2E)', () => {
  let user = {
    id: '0190a3c2-d3b2-70b3-9e45-1b2a3c4d5e6f',
    team_id: '0190a3c2-d3b2-70b3-9e45-1b2a3c4d5e60',
    email: 'test_e2e_auth@example.com',
    password: 'securepassword123',
    role: 'admin'
  };

  beforeAll(async () => {
    // Make sure users table exists and we can insert a test user
    const hashed = await bcrypt.hash(user.password, 10);
    
    // We insert a team first if teams table exists. Based on test-data.sql there should be a default team.
    // If we get an error about foreign key constraints, we'll insert a team.
    try {
      await db.query(`
        INSERT INTO teams (id, name, plan, created_at, updated_at)
        VALUES ($1, 'E2E Team', 'free', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [user.team_id]);
      
      await db.query(`
        INSERT INTO users (id, team_id, email, password_hash, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (email) DO UPDATE SET password_hash = $4
      `, [user.id, user.team_id, user.email, hashed, user.role]);
    } catch (e) {
      console.error('Error setting up DB for E2E:', e);
    }
  });

  afterAll(async () => {
    await db.query('DELETE FROM users WHERE email = $1', [user.email]);
    await db.query('DELETE FROM teams WHERE id = $1', [user.team_id]);
    await db.end();
  });

  describe('POST /api/auth/login', () => {
    it('should return tokens for valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toContain('refreshToken');
    });

    it('should fail with invalid password', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'wrong' })
        .expect(401);
    });

    it('should fail with missing fields', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email })
        .expect(400);
    });
  });
});
