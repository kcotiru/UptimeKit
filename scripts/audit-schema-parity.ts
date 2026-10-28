/**
 * Read-only schema parity audit: compares the public-schema catalogs of two databases.
 *
 *   npm run audit:parity -- --a <url> --b <url>
 *
 * Exits 1 when they differ. Exists because the baseline migration is recorded without
 * being executed, which asserts that production matches supabase/schema.sql; edits made
 * inside CREATE TABLE IF NOT EXISTS never reach an existing table, so nothing else checks.
 *
 * Read-only by construction: every connection runs SET default_transaction_read_only = on
 * before any query (and is verified), and every query is a SELECT on system catalogs.
 * Targets come from --a/--b only; DATABASE_URL is never read. A hosted target needs
 * MIGRATE_CONFIRM=<project ref>, and --a may not equal --b. Never imports
 * src/worker/config/redis.ts.
 *
 * The audit compares two live databases, never a database against schema.sql, so
 * auditing production means building a reference database from schema.sql first:
 * docs/operations.md -> "Baselining an existing project".
 *
 * Use a direct or session-pooler URL (port 5432), not a transaction pooler (6543): SET is
 * per-session, and the SHOW check below cannot detect a pooler routing statements to
 * different backends. (Every query is still a SELECT, so nothing could be written anyway.)
 *
 * Scope: the public schema only. NOT compared (known gaps):
 *   - cron.job: the real guard behind the partition rotation lives there. Most consequential gap.
 *   - grants/privileges (anon, authenticated), views, sequences, enums and custom types
 *   - extensions, and auth/storage objects such as triggers on auth.users
 *   - which dated ping_logs_raw children exist (they roll daily); only the key and
 *     each child's shape are compared
 * A category that is empty on both sides fails the run: it means the query is broken.
 */
import { Client } from 'pg';
import { confirmValueFor, isHostedUrl, sslFor } from '../src/db/migrate';

// Child partitions of ping_logs_raw are compared as a set (below), not as tables.
const NOT_PARTITION = `NOT c.relispartition`;

// Each category: a SELECT returning one string per item, so a diff is a set difference.
const CATEGORIES: Record<string, string> = {
  // Table-level RLS flags: if RLS is off, every matching policy is inert.
  tables: `
    SELECT format('%s rls=%s force=%s', c.relname, c.relrowsecurity, c.relforcerowsecurity) AS item
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relkind IN ('r', 'p') AND ${NOT_PARTITION}`,
  columns: `
    SELECT format('%s.%s %s %s default=%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
                  CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END,
                  coalesce(pg_get_expr(d.adbin, d.adrelid), '-')) AS item
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE c.relkind IN ('r', 'p') AND ${NOT_PARTITION} AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `
    SELECT format('%s.%s %s', c.relname, k.conname, pg_get_constraintdef(k.oid)) AS item
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE ${NOT_PARTITION}`,
  indexes: `
    SELECT format('%s.%s %s', tablename, indexname, indexdef) AS item
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename NOT IN (
             SELECT c.relname FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
              WHERE c.relispartition)`,
  policies: `
    SELECT format('%s.%s %s roles=%s using=%s check=%s', tablename, policyname, cmd, roles,
                  coalesce(qual, '-'), coalesce(with_check, '-')) AS item
      FROM pg_policies WHERE schemaname = 'public'`,
  // prosrc is where CREATE OR REPLACE drift hides.
  functions: `
    SELECT format('%s(%s) returns %s secdef=%s volatility=%s config=%s%s', p.proname,
                  pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
                  p.prosecdef, p.provolatile, coalesce(p.proconfig::text, '-'),
                  E'\n' || p.prosrc) AS item
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'`,
  triggers: `
    SELECT format('%s.%s %s', c.relname, t.tgname, pg_get_triggerdef(t.oid)) AS item
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE NOT t.tgisinternal AND ${NOT_PARTITION}`,
  // Dated children roll daily (create_daily_partition / drop_expired_partitions), so which
  // days exist is operational, not schema. Compare the partition key and each child's
  // shape instead: name pattern with the date masked, and whether RLS is on.
  'ping_logs_raw partitions': `
    SELECT 'key ' || pg_get_partkeydef(p.oid) AS item
      FROM pg_class p JOIN pg_namespace n ON n.oid = p.relnamespace AND n.nspname = 'public'
     WHERE p.relname = 'ping_logs_raw'
    UNION
    SELECT format('child %s rls=%s', regexp_replace(c.relname, '[0-9]{8}$', 'YYYYMMDD'), c.relrowsecurity)
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent AND p.relname = 'ping_logs_raw'
      JOIN pg_namespace n ON n.oid = p.relnamespace AND n.nspname = 'public'`,
};

function arg(args: string[], name: string): string {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (!v) throw new Error(`Usage: npm run audit:parity -- --a <url> --b <url> (missing ${name})`);
  return v;
}

// Throws, before any connection exists, when a hosted target is not confirmed.
function guard(url: string): void {
  if (!isHostedUrl(url)) return;
  const expected = confirmValueFor(url);
  if (process.env.MIGRATE_CONFIRM !== expected) {
    throw new Error(
      `Refusing to connect to a hosted database. Re-run with MIGRATE_CONFIRM=${expected} ` +
        `once you are sure the target is the one you intend. Use the direct or session-pooler ` +
        `URL (port 5432), not a transaction pooler (6543): SET is per-session and the read-only ` +
        `check cannot detect a pooler routing statements to different backends.`
    );
  }
}

async function open(url: string): Promise<Client> {
  const client = new Client({ connectionString: url, ...sslFor(url) });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const { rows } = await client.query('SHOW default_transaction_read_only');
    if (rows[0].default_transaction_read_only !== 'on') throw new Error('could not enable read-only mode');
  } catch (err) {
    await client.end();
    throw err;
  }
  return client;
}

async function snapshot(client: Client): Promise<Record<string, Set<string>>> {
  const out: Record<string, Set<string>> = {};
  for (const [name, sql] of Object.entries(CATEGORIES)) {
    out[name] = new Set((await client.query<{ item: string }>(sql)).rows.map((r) => r.item));
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [urlA, urlB] = [arg(args, '--a').trim(), arg(args, '--b').trim()];
  // A database compared with itself reports "No differences found" and exits 0. That is a
  // vacuous pass on the one run that gates a one-way door: once the baseline row is
  // written to production, backward drift is undetectable forever. Exact-string
  // equality after a trim catches the realistic mistake, which is pasting one URL twice.
  if (urlA === urlB) {
    throw new Error('--a and --b are the same URL. Comparing a database with itself always passes.');
  }
  // Both guarded before the first connection opens.
  guard(urlA);
  guard(urlB);
  const a = await open(urlA);
  let snapA, snapB;
  try {
    const b = await open(urlB);
    try {
      snapA = await snapshot(a);
      snapB = await snapshot(b);
    } finally {
      await b.end();
    }
  } finally {
    await a.end();
  }

  let diffs = 0;
  const counts: string[] = [];
  const empty: string[] = [];
  for (const name of Object.keys(CATEGORIES)) {
    counts.push(`${name}: ${snapA[name].size}/${snapB[name].size}`);
    if (!snapA[name].size && !snapB[name].size) empty.push(name);
    const onlyA = [...snapA[name]].filter((x) => !snapB[name].has(x)).sort();
    const onlyB = [...snapB[name]].filter((x) => !snapA[name].has(x)).sort();
    if (!onlyA.length && !onlyB.length) continue;
    diffs += onlyA.length + onlyB.length;
    console.log(`\n== ${name} ==`);
    for (const x of onlyA) console.log(`  only in A: ${x}`);
    for (const x of onlyB) console.log(`  only in B: ${x}`);
  }
  console.log(`\nItems compared (A/B): ${counts.join(", ")}`);
  if (empty.length) {
    console.log(`ERROR: empty on both sides, the query is probably wrong: ${empty.join(', ')}`);
    process.exit(1);
  }
  console.log(
    diffs
      ? `${diffs} difference(s) found.`
      : 'No differences found in the public-schema categories above (see header for what is not compared).'
  );
  process.exit(diffs ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
