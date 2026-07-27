-- Seed script for test environment validation

INSERT INTO teams (id, name, plan, quota_limits) VALUES
  ('018e3c50-7f28-7000-8000-000000000001', 'Team Alpha', 'pro', '{"monitors": 100}'),
  ('018e3c50-7f28-7000-8000-000000000002', 'Team Beta', 'free', '{"monitors": 5}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, team_id, email, password_hash, role) VALUES
  ('018e3c50-7f28-7000-8000-000000000011', '018e3c50-7f28-7000-8000-000000000001', 'alpha-admin@example.com', 'hash123', 'admin'),
  ('018e3c50-7f28-7000-8000-000000000012', '018e3c50-7f28-7000-8000-000000000002', 'beta-admin@example.com', 'hash456', 'admin')
ON CONFLICT (id) DO NOTHING;

INSERT INTO monitors (id, team_id, url, expected_status, check_interval, status) VALUES
  ('018e3c50-7f28-7000-8000-000000000101', '018e3c50-7f28-7000-8000-000000000001', 'https://api.alpha.com/health', 200, 60, 'up'),
  ('018e3c50-7f28-7000-8000-000000000102', '018e3c50-7f28-7000-8000-000000000001', 'https://web.alpha.com', 200, 30, 'up'),
  ('018e3c50-7f28-7000-8000-000000000103', '018e3c50-7f28-7000-8000-000000000002', 'https://beta.com', 200, 60, 'up')
ON CONFLICT (id) DO NOTHING;
