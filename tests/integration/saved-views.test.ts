import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Saved Views Integration / Validation Tests', () => {
  it('validates 007_create_saved_views.sql schema and indices', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/007_create_saved_views.sql'), 'utf8');
    expect(sql).toContain('configuration JSONB NOT NULL');
    expect(sql).toContain('share_token VARCHAR(255) NOT NULL UNIQUE');
    expect(sql).toContain('idx_saved_views_share_token');
  });

  it('validates 012_enable_rls_views.sql policy configuration', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/012_enable_rls_views.sql'), 'utf8');
    expect(sql).toContain('tenant_isolation_views');
    expect(sql).toContain('app.current_team_id');
  });
});
