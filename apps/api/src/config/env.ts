import "dotenv/config";
import { envSchema } from "./envSchema.js";

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
