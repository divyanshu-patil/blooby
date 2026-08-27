import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Service-role client. Used only for the things Prisma genuinely cannot do:
 * listing auth.users (Supabase-owned schema, exposed through the Admin API) and
 * writing to Storage. Everything in the public schema goes through Prisma instead.
 */
export const admin = createClient(env.supabaseUrl, env.supabaseSecretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
