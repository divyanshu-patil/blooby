import "dotenv/config";
import { z } from "zod";

/**
 * Every value the server needs, validated once at boot.
 *
 * The point is to fail loudly and specifically at startup rather than at whichever
 * request first touches a missing key — a half-configured server that accepts traffic
 * and then 500s on save is worse than one that refuses to start.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  APP_URL: z.string().url().default("http://localhost:5173"),
  ADMIN_URL: z.string().url().default("http://localhost:5174"),

  SUPABASE_URL: z.string().url(),
  /** Bypasses RLS. Server only — never reaches a browser bundle. */
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_JWKS_URL: z.string().url(),

  /** Direct Postgres connection for Prisma (session pooler, port 5432). */
  DATABASE_URL: z.string().url(),

  AWS_REGION: z.string().min(1),
  AWS_S3_BUCKET: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),

  /** Content types the storage layer will accept. Project JSON only, by default. */
  ALLOWED_MEDIA_TYPES: z.string().default("application/json"),
  /** Hard ceiling on a single uploaded project payload. */
  MAX_PROJECT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024),

  // Copilot keys deliberately do NOT live here. They are rows in public.copilot_keys,
  // managed from the admin dashboard: a pool in an env var means rotating a key is a
  // redeploy, only the person holding the host can do it, and every key is visible to
  // anything that can read the process environment.
  OLLAMA_URL: z.string().url().default("https://ollama.com"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration — the server cannot start.\n${issues}\n\n` +
      `See apps/api/.env.example for the full list.`,
  );
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === "production",
  corsOrigins: [raw.APP_URL, raw.ADMIN_URL].map((u) => u.replace(/\/+$/, "")),
  allowedMediaTypes: raw.ALLOWED_MEDIA_TYPES.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export type Env = typeof env;
