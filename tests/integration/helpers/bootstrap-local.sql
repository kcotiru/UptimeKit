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
-- Supabase project that statement — and everything after it in schema.sql —
-- aborted. Matching Supabase's layout here is what makes this harness catch that.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $b$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $b$;
DO $b$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $b$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

-- Supabase-like grants: Supabase leans on RLS rather than table grants, so
-- anon/authenticated can SELECT/INSERT/UPDATE/DELETE against every table and
-- RLS is the only thing standing between them and the data. Without these
-- grants, an "anon cannot read the tables" test assertion in this harness
-- would pass because of a permission denied error, not because RLS actually
-- blocked the row — a false positive that hides a broken policy.
-- This file runs against a table-less, freshly created database (schema.sql
-- applies afterwards, from each test file's beforeAll), so the immediate GRANT
-- below has nothing to act on yet. ALTER DEFAULT PRIVILEGES is what actually
-- matters: it makes every table schema.sql goes on to CREATE (as this same
-- `postgres` role, matching DATABASE_TEST_URL) carry the same grants, exactly
-- as Supabase's own project-provisioning default privileges do.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
