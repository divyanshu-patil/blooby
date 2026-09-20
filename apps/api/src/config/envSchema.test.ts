import { expect, it } from 'vitest';
import { envSchema } from './envSchema.js';

/** The minimum a server needs, as the schema sees it. */
const base = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  SUPABASE_JWKS_URL: 'https://x.supabase.co/jwks',
  DATABASE_URL: 'postgresql://u:p@aws-0-r.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1',
  AWS_REGION: 'ap-south-1',
  AWS_S3_BUCKET: 'b',
  AWS_ACCESS_KEY_ID: 'id',
  AWS_SECRET_ACCESS_KEY: 'secret',
};

/** Parses, and fails the test with the real issues if it should have succeeded. */
const parse = (over: Record<string, unknown> = {}) => {
  const r = envSchema.safeParse({ ...base, ...over });
  return r;
};
const firstMessage = (url: string) => {
  const r = envSchema.safeParse({ ...base, DATABASE_URL: url });
  return r.success ? '' : r.error.issues[0].message;
};

it('accepts a complete configuration and defaults the optional values', () => {
  const r = parse();
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  expect(r.data.NODE_ENV).toBe('development');
  expect(r.data.PORT).toBe(3000);
  expect(r.data.APP_URL).toBe('http://localhost:5173');
});

it('names a missing required value instead of silently defaulting it', () => {
  const { SUPABASE_SECRET_KEY: _omitted, ...rest } = base;
  const r = envSchema.safeParse(rest);
  expect(r.success).toBe(false);
  if (r.success) return;
  expect(r.error.issues.map((i) => i.path[0])).toContain('SUPABASE_SECRET_KEY');
});

/**
 * The regression this exists for. Pointing DATABASE_URL at Supabase's SESSION pooler caps
 * the project at 15 client connections, and a watch-mode dev server exhausts that in a
 * handful of restarts — after which every request fails with EMAXCONNSESSION, or with a
 * bare "Can't reach database server" that sends you hunting a network fault. The schema
 * refuses it at boot and names the fix, so it cannot be rediscovered the slow way.
 */
it('refuses the session pooler, and says what to do instead', () => {
  const url = 'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
  expect(envSchema.safeParse({ ...base, DATABASE_URL: url }).success).toBe(false);
  expect(firstMessage(url)).toMatch(/6543/);
  expect(firstMessage(url)).toMatch(/pgbouncer=true/);
});

it('requires both parameters the transaction pooler needs', () => {
  const host = 'postgresql://u:p@aws-0-r.pooler.supabase.com:6543/postgres';
  expect(firstMessage(host)).toMatch(/pgbouncer=true/);
  expect(firstMessage(`${host}?pgbouncer=true`)).toMatch(/connection_limit/);
  expect(parse({ DATABASE_URL: `${host}?pgbouncer=true&connection_limit=1` }).success).toBe(true);
});

it('leaves a direct, non-pooler connection on 5432 alone', () => {
  // the 15-connection cap is a property of the pooler, not of the port
  expect(parse({ DATABASE_URL: 'postgresql://u:p@db.x.supabase.co:5432/postgres' }).success).toBe(true);
});

it('keeps ALLOWED_MEDIA_TYPES as the raw list env.ts splits', () => {
  const r = parse({ ALLOWED_MEDIA_TYPES: 'application/json , image/png,' });
  if (!r.success) throw new Error('should have parsed');
  expect(r.data.ALLOWED_MEDIA_TYPES).toBe('application/json , image/png,');
});

it('rejects a PORT that is not a positive integer', () => {
  expect(parse({ PORT: 'nope' }).success).toBe(false);
  expect(parse({ PORT: '-1' }).success).toBe(false);
  const r = parse({ PORT: '8080' });
  expect(r.success && r.data.PORT).toBe(8080);
});

/**
 * TRUST_PROXY decides whether X-Forwarded-For is believed. Both mistakes are costly: unset
 * behind a load balancer gives the whole deployment one rate-limit bucket, and trusting
 * everything lets a client forge its address to escape its own.
 */
it('refuses a permissive trust-proxy setting, and explains the risk', () => {
  for (const v of ['true', 'TRUE', '*']) {
    const r = parse({ TRUST_PROXY: v });
    expect(r.success, v).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/forge/);
  }
});

it('takes a hop count, a list of addresses, or nothing at all', () => {
  for (const v of ['1', '2', 'loopback, 10.0.0.0/8', '', 'false']) {
    expect(parse({ TRUST_PROXY: v }).success, v).toBe(true);
  }
  expect(parse().success).toBe(true);   // absent is fine: no proxy in development
});
