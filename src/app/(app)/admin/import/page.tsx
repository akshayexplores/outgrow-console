import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AdminTabs } from "../admin-tabs";
import { getExampleCounts, listOwnerCandidates } from "../import-actions";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Admin · Data import" };

async function libraryCounts() {
  const supabase = await createClient();
  const tables = ["service_lines", "plays", "list_definitions", "focus_calendar", "ai_routes", "picklists"] as const;
  const out: Record<string, number> = {};
  await Promise.all(tables.map(async (t) => {
    const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
    out[t] = count ?? 0;
  }));
  return out;
}

export default async function ImportPage() {
  await requireAdmin();
  const [counts, examples, owners] = await Promise.all([libraryCounts(), getExampleCounts(), listOwnerCandidates()]);
  return (
    <Page title="Admin" wide>
      <AdminTabs current="import" />
      <ImportClient library={counts} examples={examples} owners={owners} />
    </Page>
  );
}
