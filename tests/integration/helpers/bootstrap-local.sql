-- Stubs the Supabase-provided pieces that a plain local Postgres lacks, so
-- supabase/schema.sql (which assumes it's running on Supabase) can apply
-- cleanly: the `auth` schema, `auth.uid()`, and the `anon`/`authenticated`
-- roles that Supabase provisions automatically on a real project.
--
-- Apply once against a fresh local test database before running applySchema():
--   PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d uptimekit_sdd_test -f tests/integration/helpers/bootstrap-local.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $b$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $b$;
DO $b$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $b$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
