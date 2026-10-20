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
 * MIGRATE_CONFIRM=<project ref>. Never imports src/worker/config/redis.ts.
 */
import { Client } from 'pg';
import { confirmValueFor, isHostedUrl } from '../src/db/migrate';

// Child partitions of ping_logs_raw are compared as a set (below), not as tables.
const NOT_PARTITION = `NOT c.relispartition`;

// Each category: a SELECT returning one string per item, so a diff is a set difference.
const CATEGORIES: Record<string, string> = {
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
       AND tablename NOT IN (SELECT c.relname FROM pg_class c WHERE c.relispartition)`,
  policies: `
    SELECT format('%s.%s %s roles=%s using=%s check=%s', tablename, policyname, cmd, roles,
                  coalesce(qual, '-'), coalesce(with_check, '-')) AS item
      FROM pg_policies WHERE schemaname = 'public'`,
  // prosrc is where CREATE OR REPLACE drift hides.
  functions: `
    SELECT format('%s(%s)%s', p.proname, pg_get_function_identity_arguments(p.oid),
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

async function open(url: string): Promise<Client> {
  if (isHostedUrl(url)) {
    const expected = confirmValueFor(url);
    if (process.env.MIGRATE_CONFIRM !== expected) {
      throw new Error(
        `Refusing to connect to a hosted database. Re-run with MIGRATE_CONFIRM=${expected} ` +
          `once you are sure the target is the one you intend.`
      );
    }
  }
  const client = new Client({ connectionString: url });
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
  const [urlA, urlB] = [arg(args, '--a'), arg(args, '--b')];
  // Both are validated before the first connection opens.
  for (const u of [urlA, urlB]) if (isHostedUrl(u)) confirmValueFor(u);
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
  for (const name of Object.keys(CATEGORIES)) {
    const onlyA = [...snapA[name]].filter((x) => !snapB[name].has(x)).sort();
    const onlyB = [...snapB[name]].filter((x) => !snapA[name].has(x)).sort();
    if (!onlyA.length && !onlyB.length) continue;
    diffs += onlyA.length + onlyB.length;
    console.log(`\n== ${name} ==`);
    for (const x of onlyA) console.log(`  only in A: ${x}`);
    for (const x of onlyB) console.log(`  only in B: ${x}`);
  }
  console.log(diffs ? `\n${diffs} difference(s) found.` : 'No differences found.');
  process.exit(diffs ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
