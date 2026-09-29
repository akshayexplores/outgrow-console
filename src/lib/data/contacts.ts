import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactLite } from "@/lib/log";

/** PostgREST `or(...)` filters are a mini-language: keep user text from changing their meaning. */
export const safeTerm = (s: string) => s.replace(/[,()%*\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

type ContactRow = { contact_id: string; first_name: string; last_name: string; preferred_name: string | null; job_title: string | null; account_id: string; country: string | null; opt_out_channels: string[] | null; contact_status: string | null; preferred_channel: string | null };
type AccountRow = { account_id: string; name: string; country: string | null };

const CONTACT_COLS = "contact_id, first_name, last_name, preferred_name, job_title, account_id, country, opt_out_channels, contact_status, preferred_channel";

async function withAccounts(supabase: SupabaseClient, rows: ContactRow[]): Promise<ContactLite[]> {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.account_id))];
  const { data } = await supabase.from("accounts_safe").select("account_id, name, country").in("account_id", ids);
  const byId = new Map((data as AccountRow[] | null ?? []).map((a) => [a.account_id, a]));
  return rows.map((r) => ({
    contact_id: r.contact_id,
    name: `${r.preferred_name?.trim() || r.first_name} ${r.last_name}`.trim(),
    job_title: r.job_title, account_id: r.account_id, account_name: byId.get(r.account_id)?.name ?? "Account",
    country: r.country, account_country: byId.get(r.account_id)?.country ?? null,
    opt_out_channels: r.opt_out_channels, contact_status: r.contact_status, preferred_channel: r.preferred_channel,
  }));
}

export async function contactsByIds(supabase: SupabaseClient, ids: string[]): Promise<ContactLite[]> {
  const uniq = [...new Set(ids)].slice(0, 60);
  if (uniq.length === 0) return [];
  const { data } = await supabase.from("contacts_safe").select(CONTACT_COLS).in("contact_id", uniq);
  const rows = (data ?? []) as ContactRow[];
  const order = new Map(uniq.map((id, i) => [id, i]));
  return (await withAccounts(supabase, rows)).sort((a, b) => (order.get(a.contact_id) ?? 0) - (order.get(b.contact_id) ?? 0));
}

/** Search by contact name or account name. Contacts marked "Left company" are hidden. */
export async function searchContactsLite(supabase: SupabaseClient, query: string): Promise<ContactLite[]> {
  const q = safeTerm(query);
  if (q.length < 2) return [];
  const [byName, accts] = await Promise.all([
    supabase.from("contacts_safe").select(CONTACT_COLS).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,preferred_name.ilike.%${q}%`).limit(14),
    supabase.from("accounts_safe").select("account_id").ilike("name", `%${q}%`).limit(5),
  ]);
  const rows = ((byName.data ?? []) as ContactRow[]).filter((r) => r.contact_status !== "Left company");
  const acctIds = (accts.data ?? []).map((a) => a.account_id as string);
  if (acctIds.length) {
    const { data } = await supabase.from("contacts_safe").select(CONTACT_COLS).in("account_id", acctIds).limit(14);
    for (const r of (data ?? []) as ContactRow[]) if (r.contact_status !== "Left company" && !rows.some((x) => x.contact_id === r.contact_id)) rows.push(r);
  }
  return withAccounts(supabase, rows.slice(0, 12));
}

/** People this person is most likely to be logging about: this week's open assignments, then recent touches. */
export async function suggestedContactIds(supabase: SupabaseClient, personId: string, weekStart: string, since: string): Promise<string[]> {
  const [asg, touches] = await Promise.all([
    supabase.from("assignments").select("contact_id").eq("assignee_id", personId).eq("week_start", weekStart).eq("status", "Open").not("contact_id", "is", null).limit(12),
    supabase.from("touches").select("contact_id, touch_date").eq("person_id", personId).gte("touch_date", since).not("contact_id", "is", null).order("touch_date", { ascending: false }).limit(20),
  ]);
  const out: string[] = [];
  for (const r of [...(asg.data ?? []), ...(touches.data ?? [])]) {
    const id = r.contact_id as string | null;
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 12);
}
