import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReferenceSeed, type Row } from "./build";

export type SeedMode = "missing" | "reset";
export interface SeedReport { table: string; total: number; written: number }

const BATCH = 200;

/**
 * Idempotent upsert of the library seeds (service lines, capabilities, proof points, plays, picklists, lists, channel rules, focus calendar, AI routes).
 *  - "missing": inserts only rows that don't exist yet, so edits made in the app (a play approved, a list switched on) are never overwritten. Default.
 *  - "reset":   overwrites every seeded row with the shipped defaults. Leader/admin edits to those rows are lost.
 * Needs a service-role client (library tables are leader-write under RLS).
 */
export async function applyReferenceSeed(client: SupabaseClient, mode: SeedMode = "missing"): Promise<SeedReport[]> {
  const report: SeedReport[] = [];
  for (const t of buildReferenceSeed()) {
    let written = 0;
    for (let i = 0; i < t.rows.length; i += BATCH) {
      const chunk: Row[] = t.rows.slice(i, i + BATCH);
      const { data, error } = await client
        .from(t.table)
        .upsert(chunk, { onConflict: t.pk, ignoreDuplicates: mode === "missing" })
        .select(t.pk);
      if (error) throw new Error(`Seeding ${t.table} failed: ${error.message}`);
      written += data?.length ?? 0;
    }
    report.push({ table: t.table, total: t.rows.length, written });
  }
  return report;
}

/** Copies ADMIN_EMAIL (and the optional allowed domain) into app_settings. The admin email is always synced from the environment. */
export async function syncSettingsFromEnv(client: SupabaseClient, env: { adminEmail: string; allowedDomain?: string }): Promise<void> {
  const rows = [{ key: "admin_email", value: env.adminEmail.trim().toLowerCase() }];
  if (env.allowedDomain !== undefined) rows.push({ key: "allowed_email_domain", value: env.allowedDomain.trim().toLowerCase() });
  const { error } = await client.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(`Saving settings failed: ${error.message}`);
}
