import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/types";
import { addDays, todayIST } from "@/lib/dates";

export interface AccountRow {
  account_id: string; name: string; region: string | null; tier: string | null; customer_status: string | null;
  service_lines_bought: number | null; coverage_pct: number | null; days_since_touch: number | null; owner_name: string | null; won_usd: number | null;
}

const pct = (r: unknown) => (typeof r === "number" || typeof r === "string") && Number.isFinite(Number(r)) ? Math.round(Number(r) * 100) : null;
const tierLetter = (t: string | null) => (t ? t.slice(0, 1) : null);

export async function loadAccountList(supabase: SupabaseClient, me: Me): Promise<AccountRow[]> {
  const { data } = await supabase.from("accounts_safe")
    .select("account_id, name, region, tier, customer_status, service_lines_bought, coverage_ratio, days_since_proactive_touch, outgrow_owner_id")
    .or("customer_status.is.null,customer_status.neq.Pipeline only")
    .order("days_since_proactive_touch", { ascending: false, nullsFirst: true })
    .limit(300);
  const rows = (data ?? []) as Record<string, unknown>[];
  const ownerIds = [...new Set(rows.map((r) => r.outgrow_owner_id as string | null).filter((x): x is string => !!x))];
  const [owners, won] = await Promise.all([
    ownerIds.length ? supabase.from("acsia_people").select("person_id, full_name").in("person_id", ownerIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    me.can_see_money ? supabase.from("opportunities_safe").select("account_id, estimated_value_usd").eq("stage", "Won").limit(5000) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const ownerName = new Map((owners.data ?? []).map((p) => [p.person_id as string, p.full_name as string]));
  const wonBy = new Map<string, number>();
  for (const o of won.data ?? []) wonBy.set(o.account_id as string, (wonBy.get(o.account_id as string) ?? 0) + Number(o.estimated_value_usd ?? 0));
  return rows.map((r) => ({
    account_id: r.account_id as string, name: r.name as string, region: r.region as string | null, tier: tierLetter(r.tier as string | null), customer_status: r.customer_status as string | null,
    service_lines_bought: r.service_lines_bought as number | null, coverage_pct: pct(r.coverage_ratio), days_since_touch: r.days_since_proactive_touch as number | null,
    owner_name: r.outgrow_owner_id ? ownerName.get(r.outgrow_owner_id as string) ?? null : null, won_usd: me.can_see_money ? (wonBy.get(r.account_id as string) ?? 0) : null,
  }));
}

export interface AccountContact { contact_id: string; name: string; job_title: string | null; buying_role: string | null; strength: number | null; days_since_touch: number | null; status: string | null }
export interface AccountDetail {
  account_id: string; name: string; tier: string | null; track: string | null; region: string | null; parent_name: string | null; customer_status: string | null;
  service_lines_bought: number | null; coverage_pct: number | null; days_since_touch: number | null; contacts_mapped: number | null; buying_committee_est: number | null;
  open_pipeline_usd: number | null; programmes_count: number;
  contacts: AccountContact[];
  whitespace: { service_line_id: string; status: string }[];
  competitors: string[];
  units: { org_unit_id: string; name: string; acsia_presence: string | null }[];
  programmes: { programme_id: string; name: string; status: string | null; health: string | null; current_headcount: number | null }[];
  recent: { touch_id: string; person_name: string; contact_name: string; summary: string; n: number; date: string }[];
  needs: { service_line_id: string; status: string }[];
  proposalsOverdue: { name: string; age_days: number }[];
}

export async function loadAccountDetail(supabase: SupabaseClient, me: Me, id: string): Promise<AccountDetail | null> {
  const { data: a } = await supabase.from("accounts_safe")
    .select("account_id, name, tier, track, region, parent_account_id, customer_status, service_lines_bought, coverage_ratio, days_since_proactive_touch, contacts_mapped, buying_committee_est")
    .eq("account_id", id).maybeSingle();
  if (!a) return null;
  const since = addDays(todayIST(), -14);
  const [con, ws, units, progs, opps, touches, parent] = await Promise.all([
    supabase.from("contacts_safe").select("contact_id, first_name, last_name, preferred_name, job_title, buying_role, relationship_strength, days_since_proactive_touch, contact_status").eq("account_id", id).order("relationship_strength", { ascending: false, nullsFirst: false }).limit(80),
    supabase.from("whitespace_safe").select("service_line_id, status, competitor_id").eq("account_id", id).limit(60),
    supabase.from("org_units_safe").select("org_unit_id, name, acsia_presence").eq("account_id", id).limit(60),
    supabase.from("programmes_safe").select("programme_id, name, status, health, current_headcount").or(`contracting_account_id.eq.${id},end_customer_account_id.eq.${id}`).limit(40),
    supabase.from("opportunities_safe").select("name, stage, estimated_value_usd, proposal_age_days").eq("account_id", id).limit(100),
    supabase.from("touches").select("touch_id, touch_date, person_id, contact_id").eq("account_id", id).gte("touch_date", since).is("archived_at", null).order("touch_date", { ascending: false }).limit(12),
    a.parent_account_id ? supabase.from("accounts_safe").select("name").eq("account_id", a.parent_account_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const compIds = me.can_see_money ? [...new Set((ws.data ?? []).map((w) => w.competitor_id as string | null).filter((x): x is string => !!x))] : [];
  const touchRows = (touches.data ?? []) as { touch_id: string; touch_date: string; person_id: string; contact_id: string | null }[];
  const personIds = [...new Set(touchRows.map((t) => t.person_id))];
  const touchIds = touchRows.map((t) => t.touch_id);
  const [comp, people, acts] = await Promise.all([
    compIds.length ? supabase.from("competitors").select("name").in("competitor_id", compIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    personIds.length ? supabase.from("acsia_people").select("person_id, full_name").in("person_id", personIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    touchIds.length ? supabase.from("actions_safe").select("touch_id, action_code").in("touch_id", touchIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const contacts: AccountContact[] = (con.data ?? []).map((c) => ({
    contact_id: c.contact_id as string, name: `${(c.preferred_name as string | null)?.trim() || c.first_name} ${c.last_name}`.trim(), job_title: c.job_title as string | null,
    buying_role: c.buying_role as string | null, strength: c.relationship_strength as number | null, days_since_touch: c.days_since_proactive_touch as number | null, status: c.contact_status as string | null,
  }));
  const cName = new Map(contacts.map((c) => [c.contact_id, c.name]));
  const pName = new Map((people.data ?? []).map((p) => [p.person_id as string, p.full_name as string]));
  const codes = new Map<string, string[]>();
  for (const x of acts.data ?? []) codes.set(x.touch_id as string, [...(codes.get(x.touch_id as string) ?? []), x.action_code as string]);
  const oppRows = (opps.data ?? []) as { name: string; stage: string; estimated_value_usd: number | null; proposal_age_days: number | null }[];
  const openOpps = oppRows.filter((o) => !["Won", "Lost", "Parked"].includes(o.stage));
  const wsRows = (ws.data ?? []) as { service_line_id: string; status: string }[];

  return {
    account_id: a.account_id as string, name: a.name as string, tier: (a.tier as string | null)?.slice(0, 1) ?? null, track: a.track as string | null, region: a.region as string | null,
    parent_name: (parent.data?.name as string | undefined) ?? null, customer_status: a.customer_status as string | null,
    service_lines_bought: a.service_lines_bought as number | null, coverage_pct: pct(a.coverage_ratio), days_since_touch: a.days_since_proactive_touch as number | null,
    contacts_mapped: a.contacts_mapped as number | null, buying_committee_est: a.buying_committee_est as number | null,
    open_pipeline_usd: me.can_see_money ? openOpps.reduce((s, o) => s + Number(o.estimated_value_usd ?? 0), 0) : null,
    programmes_count: (progs.data ?? []).length,
    contacts, whitespace: wsRows,
    competitors: (comp.data ?? []).map((c) => c.name as string),
    units: (units.data ?? []).map((u) => ({ org_unit_id: u.org_unit_id as string, name: u.name as string, acsia_presence: u.acsia_presence as string | null })),
    programmes: (progs.data ?? []).map((p) => ({ programme_id: p.programme_id as string, name: p.name as string, status: p.status as string | null, health: p.health as string | null, current_headcount: p.current_headcount as number | null })),
    recent: touchRows.map((t) => {
      const cs = (codes.get(t.touch_id) ?? []).sort();
      return { touch_id: t.touch_id, person_name: pName.get(t.person_id) ?? "Colleague", contact_name: (t.contact_id ? cName.get(t.contact_id) : undefined) ?? "", summary: cs.join(" · "), n: cs.length, date: t.touch_date };
    }),
    needs: wsRows.filter((w) => w.status === "Need likely" || w.status === "Need confirmed - unsourced"),
    proposalsOverdue: oppRows.filter((o) => o.stage === "Proposal sent" && (o.proposal_age_days ?? 0) > 56).map((o) => ({ name: o.name, age_days: o.proposal_age_days ?? 0 })),
  };
}
