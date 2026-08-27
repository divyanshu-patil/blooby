import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Service-role client, used only for what Prisma genuinely cannot reach: the auth.users
 * table (Supabase-owned schema, exposed through the Admin API). Everything in the public
 * schema goes through Prisma instead, so there is one query layer, not two.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
