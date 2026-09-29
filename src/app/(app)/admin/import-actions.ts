"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { errResult, okResult, type ActionResult } from "@/lib/types";
import { applyMapping, validateAccountRow, validateContactRow, type Mapping, type RowResult } from "@/lib/import";

const payloadSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).min(1, "The file has no rows.").max(5000, "Import at most 5,000 rows at a time."),
  mapping: z.record(z.string(), z.string()),
});

export interface PreviewRow { line: number; status: "new" | "exists" | "error"; label: string; messages: string[] }
export interface PreviewResult { rows: PreviewRow[]; counts: { new: number; exists: number; error: number } }

const key = (name: string, country: string) => `${name.trim().toLowerCase()}|${country}`;

async function loadAccounts() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("accounts").select("account_id,name,country").is("archived_at", null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function auditImport(kind: string, summary: string, email: string | null) {
  await createAdminClient().from("audit_log").insert({ table_name: "import", record_id: kind, field: "csv_import", new_value: summary, changed_by_email: email });
}

/** Lists roster people who can own accounts (for the "default owner" picker). */
export async function listOwnerCandidates(): Promise<{ person_id: string; full_name: string; app_role: string }[]> {
  await requireAdmin();
  const { data } = await createAdminClient().from("acsia_people").select("person_id,full_name,app_role").eq("active", true).is("archived_at", null).order("full_name");
  return (data ?? []) as { person_id: string; full_name: string; app_role: string }[];
}

export async function previewAccountsImport(input: unknown): Promise<ActionResult<PreviewResult>> {
  await requireAdmin();
  const p = payloadSchema.safeParse(input);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Bad file.");
  const existing = new Set((await loadAccounts()).map((a) => key(a.name, a.country)));
  const seen = new Set<string>();
  const rows: PreviewRow[] = p.data.rows.map((r, i) => {
    const res = validateAccountRow(applyMapping(r, p.data.mapping as Mapping), i + 2);
    if (!res.ok || !res.value) return { line: res.line, status: "error", label: r[p.data.mapping.name ?? ""] ?? "(no name)", messages: res.errors };
    const k = key(res.value.name, res.value.country);
    if (existing.has(k) || seen.has(k)) return { line: res.line, status: "exists", label: res.value.name, messages: [existing.has(k) ? "Already in the app: skipped." : "Duplicate row in this file: skipped."] };
    seen.add(k);
    return { line: res.line, status: "new", label: `${res.value.name} · ${res.value.country}`, messages: res.warnings };
  });
  return okResult({ rows, counts: { new: rows.filter((r) => r.status === "new").length, exists: rows.filter((r) => r.status === "exists").length, error: rows.filter((r) => r.status === "error").length } });
}

export async function commitAccountsImport(input: unknown, defaultOwnerId: string): Promise<ActionResult<{ added: number; skipped: number; failed: number }>> {
  const { me } = await requireAdmin();
  const p = payloadSchema.safeParse(input);
  const owner = z.string().uuid().safeParse(defaultOwnerId);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Bad file.");
  if (!owner.success) return errResult("Choose who owns imported accounts by default.");
  const admin = createAdminClient();
  const accounts = await loadAccounts();
  const existing = new Set(accounts.map((a) => key(a.name, a.country)));
  const idByName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a.account_id]));
  const { data: people } = await admin.from("acsia_people").select("person_id,email").is("archived_at", null);
  const ownerByEmail = new Map((people ?? []).map((x) => [String(x.email).toLowerCase(), String(x.person_id)]));

  const todo: { row: NonNullable<RowResult<never>["value"]> & Record<string, unknown>; parent: string | null; ownerId: string }[] = [];
  let skipped = 0, failed = 0;
  const seen = new Set<string>();
  p.data.rows.forEach((r, i) => {
    const res = validateAccountRow(applyMapping(r, p.data.mapping as Mapping), i + 2);
    if (!res.ok || !res.value) { failed++; return; }
    const k = key(res.value.name, res.value.country);
    if (existing.has(k) || seen.has(k)) { skipped++; return; }
    seen.add(k);
    todo.push({ row: res.value as never, parent: res.value.parent_account, ownerId: (res.value.owner_email && ownerByEmail.get(res.value.owner_email)) || owner.data });
  });

  let added = 0;
  const insertRow = (t: (typeof todo)[number]) => {
    const v = t.row as Record<string, unknown>;
    return {
      name: v.name, country: v.country, region: v.region, segment: v.segment, relationship_type: v.relationship_type, account_level: v.account_level, track: v.track,
      tier: v.tier, customer_status: v.customer_status, city_site: v.city_site, web_domain: v.web_domain, account_owner_id: t.ownerId,
    };
  };
  // Groups first (rows that are somebody's parent), then the rest, so parent links can resolve to freshly inserted rows.
  const parentNames = new Set(todo.map((t) => t.parent?.toLowerCase()).filter(Boolean) as string[]);
  const ordered = [...todo.filter((t) => parentNames.has(String((t.row as Record<string, unknown>).name).toLowerCase())), ...todo.filter((t) => !parentNames.has(String((t.row as Record<string, unknown>).name).toLowerCase()))];
  for (const t of ordered) {
    const parentId = t.parent ? idByName.get(t.parent.toLowerCase()) ?? null : null;
    const { data, error } = await admin.from("accounts").insert({ ...insertRow(t), parent_account_id: parentId }).select("account_id,name").single();
    if (error || !data) { failed++; continue; }
    added++;
    idByName.set(String(data.name).toLowerCase(), data.account_id);
  }
  await auditImport("accounts", `added ${added}, skipped ${skipped}, failed ${failed}`, me.email);
  revalidatePath("/accounts");
  return okResult({ added, skipped, failed });
}

async function resolveContacts(input: z.infer<typeof payloadSchema>) {
  const admin = createAdminClient();
  const accounts = await loadAccounts();
  const byName = new Map<string, { id: string; country: string }[]>();
  for (const a of accounts) {
    const k = a.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), { id: a.account_id, country: a.country }]);
  }
  const { data: existingContacts } = await admin.from("contacts").select("account_id,first_name,last_name,email").is("archived_at", null);
  const existing = new Set((existingContacts ?? []).map((c) => `${c.account_id}|${(c.email ?? "").toLowerCase() || `${c.first_name} ${c.last_name}`.toLowerCase()}`));
  const seen = new Set<string>();
  return input.rows.map((r, i) => {
    const res = validateContactRow(applyMapping(r, input.mapping as Mapping), i + 2);
    if (!res.ok || !res.value) return { res, status: "error" as const, accountId: null as string | null, messages: res.errors };
    const v = res.value;
    let candidates = byName.get(v.account.trim().toLowerCase()) ?? [];
    if (candidates.length > 1 && v.account_country) candidates = candidates.filter((c) => c.country === v.account_country);
    if (candidates.length === 0) return { res, status: "error" as const, accountId: null, messages: [`No account called “${v.account}” (import accounts first).`] };
    if (candidates.length > 1) return { res, status: "error" as const, accountId: null, messages: [`More than one account is called “${v.account}”: map an account country.`] };
    const accountId = candidates[0]!.id;
    const dupKey = `${accountId}|${v.email ?? `${v.first_name} ${v.last_name}`.toLowerCase()}`;
    if (existing.has(dupKey) || seen.has(dupKey)) return { res, status: "exists" as const, accountId, messages: ["Already in the app: skipped."] };
    seen.add(dupKey);
    return { res, status: "new" as const, accountId, messages: res.warnings };
  });
}

export async function previewContactsImport(input: unknown): Promise<ActionResult<PreviewResult>> {
  await requireAdmin();
  const p = payloadSchema.safeParse(input);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Bad file.");
  const resolved = await resolveContacts(p.data);
  const rows: PreviewRow[] = resolved.map((x) => ({ line: x.res.line, status: x.status, label: x.res.value ? `${x.res.value.first_name} ${x.res.value.last_name} · ${x.res.value.account}` : "(unreadable row)", messages: x.messages }));
  return okResult({ rows, counts: { new: rows.filter((r) => r.status === "new").length, exists: rows.filter((r) => r.status === "exists").length, error: rows.filter((r) => r.status === "error").length } });
}

export async function commitContactsImport(input: unknown): Promise<ActionResult<{ added: number; skipped: number; failed: number }>> {
  const { me } = await requireAdmin();
  const p = payloadSchema.safeParse(input);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Bad file.");
  const resolved = await resolveContacts(p.data);
  const admin = createAdminClient();
  const toInsert = resolved.filter((x) => x.status === "new" && x.res.value && x.accountId).map((x) => {
    const v = x.res.value!;
    return {
      account_id: x.accountId, first_name: v.first_name, last_name: v.last_name, job_title: v.job_title, email: v.email, phone_office: v.phone_office, phone_mobile: v.phone_mobile,
      country: v.country, seniority: v.seniority, buying_role: v.buying_role, relationship_strength: v.relationship_strength, linkedin_url: v.linkedin_url, source: "Import", contact_status: "Active",
    };
  });
  let added = 0, failed = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { error } = await admin.from("contacts").insert(chunk);
    if (error) {
      for (const one of chunk) { const { error: e1 } = await admin.from("contacts").insert(one); if (e1) failed++; else added++; }
    } else added += chunk.length;
  }
  const skipped = resolved.filter((x) => x.status === "exists").length;
  failed += resolved.filter((x) => x.status === "error").length;
  await auditImport("contacts", `added ${added}, skipped ${skipped}, failed ${failed}`, me.email);
  revalidatePath("/accounts");
  return okResult({ added, skipped, failed });
}

/* ------------------------------------------------------------------ examples (demo data) */

export async function getExampleCounts(): Promise<Record<string, number>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc("count_examples");
  return (data ?? {}) as Record<string, number>;
}

export async function removeExamples(): Promise<ActionResult<{ removed: Record<string, number> }>> {
  const { me } = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_examples");
  if (error) return errResult(error.message.replace(/^[A-Z_]+:\s*/, ""));
  const result = data as { removed: Record<string, number>; auth_user_ids: string[] };
  const admin = createAdminClient();
  for (const id of result.auth_user_ids ?? []) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  await auditImport("examples", `removed ${Object.values(result.removed).reduce((a, b) => a + b, 0)} example rows`, me.email);
  revalidatePath("/admin/import");
  revalidatePath("/admin");
  return okResult({ removed: result.removed });
}
