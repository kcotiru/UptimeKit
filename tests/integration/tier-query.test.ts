import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// These assertions read supabase/schema.sql, the frozen baseline, not the applied
// database. Migration 20261022232225 replaced select_ping_tier to add pg_temp to
// its search_path and deliberately left this file alone: nothing here asserts on
// search_path, so every proposition below is still true of the applied schema.
// The next migration that changes this function's BODY does owe the conversion in
// supabase/migrations/README.md ("Four limits", item 2), which means rewriting
// these tests to query the database instead, as part of that migration.
describe('Tier Query Function SQL Validation', () => {
  it('validates select_ping_tier SQL structure and tier boundaries', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION select_ping_tier');
    expect(sql).toContain("INTERVAL '7 days'");
    expect(sql).toContain("INTERVAL '90 days'");
    expect(sql).toContain("'raw'");
    expect(sql).toContain("'hourly'");
    expect(sql).toContain("'daily'");
  });

  it('exposes a team-parameterised tier query that select_ping_tier delegates to', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

    expect(sql).toContain('FUNCTION select_ping_tier_for_team(');
    // The wrapper must delegate, not carry a second copy of the UNION.
    const wrapper = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION select_ping_tier('));
    const wrapperBody = wrapper.slice(0, wrapper.indexOf('$$ LANGUAGE'));
    expect(wrapperBody).toContain('select_ping_tier_for_team(current_team_id()');
    expect(wrapperBody).not.toContain('UNION ALL');
  });
});
