/**
 * Applies the SQL in supabase/migrations to the database in DATABASE_URL.
 *
 *   pnpm db:migrate            # apply everything not applied yet
 *   pnpm db:migrate:status     # list applied and pending, change nothing
 *   pnpm db:migrate --baseline # record every file as applied WITHOUT running it
 *
 * Prisma is the query layer here, not the migration tool (see prisma/schema.prisma), and the
 * Supabase CLI is not a dependency — so this shells out to `psql`, which is the only thing
 * that runs a file of DDL, policies and dollar-quoted functions exactly as written.
 *
 * What has run is recorded in public.schema_migrations. `--baseline` is for a database that
 * was migrated by hand before this script existed: it marks the files as applied so the next
 * real migration is the only thing that runs.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';

const dir = new URL('../../../supabase/migrations/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const baseline = process.argv.includes('--baseline');
const statusOnly = process.argv.includes('--status');

// psql does not understand Prisma's pgbouncer parameters, and they mean nothing to one session
const url = (process.env.DATABASE_URL ?? '').split('?')[0];
if (!url) throw new Error('DATABASE_URL is not set — copy apps/api/.env.example to .env first.');

const psql = (args: string[], input?: string) => {
  try {
    return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-At', ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }).trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('psql is not installed. `brew install libpq` (then add it to PATH), or apply the SQL in the Supabase dashboard.');
    throw e;
  }
};

psql(['-c', "set client_min_messages = warning; create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now())"]);
const applied = new Set(psql(['-c', 'select version from public.schema_migrations']).split('\n').filter(Boolean));
const pending = files.filter((f) => !applied.has(f));

if (statusOnly) {
  for (const f of files) console.log(`${applied.has(f) ? 'applied ' : 'PENDING '} ${f}`);
  console.log(`\n${applied.size} applied, ${pending.length} pending`);
  process.exit(0);
}
if (!pending.length) { console.log(`Nothing to apply — ${files.length} migrations already recorded.`); process.exit(0); }

for (const f of pending) {
  if (baseline) {
    psql(['-c', `insert into public.schema_migrations (version) values ('${f}') on conflict do nothing`]);
    console.log(`recorded (not run)  ${f}`);
    continue;
  }
  console.log(`applying            ${f}`);
  // one transaction per file: a migration that fails part way leaves nothing behind
  psql(['-1', '-f', join(dir, f)]);
  psql(['-c', `insert into public.schema_migrations (version) values ('${f}')`]);
}
console.log(`\n${baseline ? 'Recorded' : 'Applied'} ${pending.length} migration(s).`);