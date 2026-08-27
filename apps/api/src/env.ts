import 'dotenv/config';

/** Fail loudly at boot rather than at the first request that needs a missing value. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} — see apps/api/.env.example`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  supabaseUrl: required('SUPABASE_URL'),
  /** service-role equivalent: bypasses RLS. Never send this to a browser. */
  supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
  jwksUrl: required('SUPABASE_JWKS_URL'),
  /** browsers allowed to call this API */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
    .split(',').map((s) => s.trim()).filter(Boolean),
  /** Ollama Cloud keys for the copilot proxy, tried in order. Optional. */
  ollamaKeys: (process.env.OLLAMA_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  ollamaUrl: process.env.OLLAMA_URL ?? 'https://ollama.com',
};
