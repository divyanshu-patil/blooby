import { config as loadDotenv } from "dotenv";
import { envSchema } from "./envSchema.js";

// Under test the environment is vitest.config.ts's committed .env.test and nothing else.
// dotenv does not overwrite what is already set, so any key .env.test happens not to
// mention used to fall through to the developer's own .env — and a test then passed or
// failed depending on whose machine it ran on (TRUST_PROXY=1 in one .env quietly broke
// the forged-forwarding-header test for exactly one person).
if (process.env.NODE_ENV !== "test") loadDotenv();

/**
 * Every value the server needs, validated once at boot.
 *
 * The point is to fail loudly and specifically at startup rather than at whichever
 * request first touches a missing key — a half-configured server that accepts traffic
 * and then 500s on save is worse than one that refuses to start.
 */
const parsed = envSchema.safeParse(process.env);

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
  // trailing slashes come and go in .env files; every URL built from these must not double up
  appUrl: raw.APP_URL.replace(/\/+$/, ""),
  publicApiUrl: raw.PUBLIC_API_URL.replace(/\/+$/, ""),
  /** what `app.set('trust proxy')` gets: false when unset, a hop count, or the list as written */
  trustProxy: ((v: string): number | string | false => {
    const t = v.trim();
    if (!t || /^(false|0|off)$/i.test(t)) return false;
    return /^\d+$/.test(t) ? Number(t) : t;
  })(raw.TRUST_PROXY),
  corsOrigins: [raw.APP_URL, raw.ADMIN_URL].map((u) => u.replace(/\/+$/, "")),
  allowedMediaTypes: raw.ALLOWED_MEDIA_TYPES.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export type Env = typeof env;
