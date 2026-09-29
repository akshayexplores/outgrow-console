import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role client: bypasses RLS. Server-only. Use it ONLY for auth admin calls (invites, sign-in links, sign-out),
 * cron jobs and seeding, and only after the caller has been authorised (requireAdmin / CRON_SECRET).
 */
export function createAdminClient() {
  return createSupabaseClient(publicEnv.supabaseUrl, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
