/**
 * Idempotent seed: library data + admin email. Run against any environment whose env vars are set:
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ADMIN_EMAIL=… npm run seed [-- --reset]
 * Reference data only. Example/demo data is loaded from the admin Data import screen, never here.
 */
import { createClient } from "@supabase/supabase-js";
import { applyReferenceSeed, syncSettingsFromEnv } from "../src/lib/seeds/apply";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = process.env.ADMIN_EMAIL;
  if (!url || !key || !admin) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ADMIN_EMAIL.");
  const mode = process.argv.includes("--reset") ? "reset" : "missing";
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await syncSettingsFromEnv(client, { adminEmail: admin, allowedDomain: process.env.ALLOWED_EMAIL_DOMAIN });
  console.log(`admin_email set (${admin.trim().toLowerCase()})`);
  const report = await applyReferenceSeed(client, mode);
  for (const r of report) console.log(`${r.table.padEnd(18)} ${String(r.written).padStart(4)} written of ${r.total} (${mode})`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
