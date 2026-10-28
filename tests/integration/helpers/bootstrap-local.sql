-- Stubs the Supabase-provided pieces that a plain local Postgres lacks, so
-- supabase/schema.sql (which assumes it's running on Supabase) can apply
-- cleanly: the `auth` schema, `auth.uid()`, and the `anon`/`authenticated`
-- roles that Supabase provisions automatically on a real project.
--
-- Apply once against a fresh local test database before running applySchema():
--   PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d uptimekit_sdd_test -f tests/integration/helpers/bootstrap-local.sql

-- Supabase installs pgcrypto into an `extensions` schema, not `public`. Putting
-- it in `public` here (the old behaviour) masked a real bug: gen_share_token()
-- in schema.sql calls gen_random_bytes() from pgcrypto, and a `LANGUAGE sql`
-- function body is validated against search_path at CREATE time, so on a real
-- Supabase project that statement, and everything after it in schema.sql,
-- aborted. Matching Supabase's layout here is what makes this harness catch that.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $b$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $b$;
DO $b$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $b$;
CREATE SCHEMA IF NOT EXISTS auth;
-- `email` and `raw_user_meta_data` exist because handle_new_user() reads both:
-- the trigger names the team from the metadata and copies the address into
-- public.users. Real auth.users has far more, but a stub that lacked these two
-- would make the signup trigger untestable here: the exact class of gap that
-- let the pgcrypto placement bug above through.
-- ADD COLUMN rather than widening the CREATE: this file has already run against
-- existing test databases, where CREATE TABLE IF NOT EXISTS is a no-op.
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

-- Supabase-like grants: Supabase leans on RLS rather than table grants, so
-- anon/authenticated hold every table privilege (SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) against every table and
-- RLS is the only thing standing between them and the data. Without these
-- grants, an "anon cannot read the tables" test assertion in this harness
-- would pass because of a permission denied error, not because RLS actually
-- blocked the row, a false positive that hides a broken policy.
-- This file runs against a table-less, freshly created database (schema.sql
-- applies afterwards, from each test file's beforeAll), so the immediate GRANT
-- below has nothing to act on yet. ALTER DEFAULT PRIVILEGES is what actually
-- matters: it makes every table schema.sql goes on to CREATE (as this same
-- `postgres` role, matching DATABASE_TEST_URL) carry the same grants, exactly
-- as Supabase's own project-provisioning default privileges do.
-- The eight-privilege list mirrors Supabase's provisioning defaults as observed
-- on the live project, so a revoke migration is proven from the real starting
-- state. MAINTAIN (VACUUM, ANALYZE, REINDEX, CLUSTER, LOCK TABLE) is the eighth:
-- pg_default_acl on the live project grants anon and authenticated `arwdDxtm`,
-- and the trailing `m` is it. Leaving it out here made a revoke of it a no-op
-- against a privilege the harness had never granted, so the harness reported a
-- guard as proven that production did not have.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- Supabase grants USAGE on the `extensions` schema to the same two roles.
-- Without it, an authenticated INSERT into saved_views or team_invites fails
-- with "function gen_random_bytes(integer) does not exist": both columns
-- default to gen_share_token(), whose search_path names `extensions`, and a
-- role that cannot see the schema cannot resolve pgcrypto inside it. The real
-- project must have this grant, or creating a share link would fail there too.
GRANT USAGE ON SCHEMA extensions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
