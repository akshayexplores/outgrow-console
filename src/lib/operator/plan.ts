import "server-only";
/**
 * The Monday planner (docs/04 job 5): loads who can call whom, asks the model for a draft (or falls back to plain rules),
 * re-checks every row in code, and hands the survivors to the database as Draft assignments for a manager to approve.
 * Runs with the service role because the cron has no signed-in person; callers must authorise first (CRON_SECRET, or a leader / delivery lead).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, daysBetween, todayIST, weekStartOf } from "@/lib/dates";
import { playIsUsable } from "@/lib/operator/guardrails";
import { planPrompt, type PlanPromptInput } from "@/lib/operator/prompts";
import { runJob } from "@/lib/operator/run";
import {
  LIST_ORDER, PLANNER_ROLES, capCandidates, dueDateFor, heuristicPlan, planOutputSchema, quotaFor, validatePlan,
  type PlanCandidate, type PlanFocus, type PlanInput, type PlanPerson, type PlanPlay, type PlannedAssignment,
} from "@/lib/operator/plan-core";

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

/** Lists whose contacts an SDR may call even without a named link (re-engagement and coverage work). */
const SDR_LISTS = new Set(["L05", "L09", "A1"]);
/** Actions the planner may attach a play for (the same set the manual assign form offers). */
const PLAN_ACTION_CODES = ["OG1.1", "OG1.2", "OG2.1", "OG2.2", "OG2.3", "OG2.4", "OG4.1"];

async function inChunks(ids: string[], size: number, run: (chunk: string[]) => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data } = await run(ids.slice(i, i + size));
    if (data) out.push(...data);
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export interface LoadOptions {
  weekStart: string;
  /** Plan only for these people (a delivery lead's team). Omit for the whole roster. */
  scopePersonIds?: string[];
  /** A redraft replaces the operator's own still-Draft rows for the scope, so they must not count as "already assigned". */
  replace: boolean;
}

export async function loadPlanInput(admin: Admin, opts: LoadOptions): Promise<PlanInput> {
  const today = todayIST();
  const prevWeek = addDays(opts.weekStart, -7);
  const scope = opts.scopePersonIds ? new Set(opts.scopePersonIds) : null;

  const [peopleRes, asgRes, prevRes, listsRes, memRes, capRes, playRes, focusRes, chanRes] = await Promise.all([
    admin.from("acsia_people").select("person_id, full_name, app_role, manager_id").eq("active", true).eq("is_participant", true).is("archived_at", null).gt("weekly_target", 0).in("app_role", [...PLANNER_ROLES]),
    admin.from("assignments").select("assignee_id, contact_id, status, operator_draft").eq("week_start", opts.weekStart).neq("status", "Dropped").is("archived_at", null),
    admin.from("assignments").select("assignee_id, status").eq("week_start", prevWeek).in("status", ["Done", "Skipped"]).is("archived_at", null),
    admin.from("list_definitions").select("list_id, name, default_play_id").eq("active", true).is("archived_at", null).in("list_id", LIST_ORDER),
    admin.from("list_memberships").select("list_id, account_id, contact_id, opportunity_id, reason, entered_at").is("exited_at", null).is("archived_at", null).not("contact_id", "is", null).in("list_id", LIST_ORDER).range(0, 999),
    admin.from("capabilities").select("capability_id, name").eq("do_not_offer", true).is("archived_at", null),
    admin.from("plays").select("play_id, title, action_code, priority, list_ids, why_it_works, approval_status, requires_signoff, to_capability_id, from_capability_id").like("approval_status", "Approved%").is("archived_at", null).in("action_code", PLAN_ACTION_CODES).limit(200),
    admin.from("focus_calendar").select("period_start, period_end, dyk_focus_play_ids, referral_focus, prompt_card_questions").is("archived_at", null).lte("period_start", opts.weekStart).gte("period_end", opts.weekStart),
    admin.from("channel_rules").select("blocked_channels, country_codes").is("archived_at", null),
  ]);

  // people the planner may name
  const allPeople = ((peopleRes.data ?? []) as Row[]).map((p) => ({ person_id: str(p.person_id), full_name: str(p.full_name), app_role: str(p.app_role), manager_id: (p.manager_id as string | null) ?? null }));
  const eligible = allPeople.filter((p) => !scope || scope.has(p.person_id));
  const eligibleIds = new Set(eligible.map((p) => p.person_id));

  // this week's live assignments (a redraft ignores the operator's own drafts for the scope: they are about to be replaced)
  const live = ((asgRes.data ?? []) as Row[]).filter((a) => !(opts.replace && a.operator_draft === true && a.status === "Draft" && (!scope || scope.has(str(a.assignee_id)))));
  const already = new Map<string, number>();
  for (const a of live) already.set(str(a.assignee_id), (already.get(str(a.assignee_id)) ?? 0) + 1);
  const assignedContactIds = [...new Set(live.map((a) => str(a.contact_id)))];

  const lastWeek = new Map<string, { done: number; skipped: number }>();
  for (const a of (prevRes.data ?? []) as Row[]) {
    const cur = lastWeek.get(str(a.assignee_id)) ?? { done: 0, skipped: 0 };
    if (a.status === "Done") cur.done += 1; else cur.skipped += 1;
    lastWeek.set(str(a.assignee_id), cur);
  }

  const people: PlanPerson[] = eligible.map((p) => ({
    person_id: p.person_id, full_name: p.full_name, app_role: p.app_role, manager_id: p.manager_id, quota: quotaFor(p.app_role),
    already: already.get(p.person_id) ?? 0, last_week: lastWeek.get(p.person_id) ?? { done: 0, skipped: 0 },
  }));

  // do-not-offer capabilities and the plays that survive them
  const blockedCaps = new Set(((capRes.data ?? []) as Row[]).map((c) => str(c.capability_id)));
  const blockedNames = ((capRes.data ?? []) as Row[]).map((c) => str(c.name));
  const listName = new Map(((listsRes.data ?? []) as Row[]).map((l) => [str(l.list_id), str(l.name)]));
  const listDefault = new Map(((listsRes.data ?? []) as Row[]).map((l) => [str(l.list_id), (l.default_play_id as string | null) ?? null]));
  const plays: PlanPlay[] = ((playRes.data ?? []) as Row[])
    .filter((p) => playIsUsable({ play_id: str(p.play_id), approval_status: str(p.approval_status), requires_signoff: p.requires_signoff as boolean | null, to_capability_id: p.to_capability_id as string | null }, blockedCaps))
    .map((p) => ({ play_id: str(p.play_id), title: str(p.title).slice(0, 90), action_code: str(p.action_code), priority: str(p.priority), list_ids: strArr(p.list_ids), blurb: str(p.why_it_works).slice(0, 140) }));
  const usablePlayIds = new Set(plays.map((p) => p.play_id));

  const focusRows = ((focusRes.data ?? []) as Row[]).sort((a, b) => daysBetween(str(a.period_start), str(a.period_end)) - daysBetween(str(b.period_start), str(b.period_end)));
  const f = focusRows[0];
  const focus: PlanFocus | null = f ? { dyk_focus_play_ids: strArr(f.dyk_focus_play_ids), referral_focus: (f.referral_focus as string | null) ?? null, questions: strArr(f.prompt_card_questions).slice(0, 5) } : null;

  // who is on a list, and who can call them
  const memberships = (memRes.data ?? []) as Row[];
  const contactIds = [...new Set(memberships.map((m) => str(m.contact_id)))];
  const contacts = await inChunks(contactIds, 80, (ids) => admin.from("contacts").select("contact_id, first_name, last_name, job_title, account_id, country, opt_out_channels, contact_status, primary_relationship_owner_id").in("contact_id", ids).is("archived_at", null));
  const contactById = new Map(contacts.map((c) => [str(c.contact_id), c]));
  const accountIds = [...new Set(contacts.map((c) => str(c.account_id)))];
  const [accounts, rels, programmes] = await Promise.all([
    inChunks(accountIds, 80, (ids) => admin.from("accounts").select("account_id, name, country, account_owner_id, outgrow_owner_id").in("account_id", ids).is("archived_at", null)),
    inChunks(contactIds, 80, (ids) => admin.from("relationships").select("contact_id, person_id").in("contact_id", ids).is("archived_at", null)),
    inChunks(accountIds, 80, (ids) => admin.from("programmes").select("programme_id, contracting_account_id, end_customer_account_id, delivery_lead_id").eq("status", "Active").is("archived_at", null).or(`contracting_account_id.in.(${ids.join(",")}),end_customer_account_id.in.(${ids.join(",")})`)),
  ]);
  const programmeIds = [...new Set(programmes.map((p) => str(p.programme_id)))];
  const team = await inChunks(programmeIds, 80, (ids) => admin.from("programme_team").select("programme_id, person_id, end_date").in("programme_id", ids).is("archived_at", null));

  const accountById = new Map(accounts.map((a) => [str(a.account_id), a]));
  const relsByContact = new Map<string, Set<string>>();
  for (const r of rels) { const s = relsByContact.get(str(r.contact_id)) ?? new Set<string>(); s.add(str(r.person_id)); relsByContact.set(str(r.contact_id), s); }
  const teamByProgramme = new Map<string, Set<string>>();
  for (const t of team) {
    if (t.end_date && str(t.end_date) < today) continue;
    const s = teamByProgramme.get(str(t.programme_id)) ?? new Set<string>(); s.add(str(t.person_id)); teamByProgramme.set(str(t.programme_id), s);
  }
  const peopleOnAccount = new Map<string, Set<string>>();
  for (const p of programmes) {
    for (const acc of [str(p.contracting_account_id), str(p.end_customer_account_id)]) {
      if (!acc) continue;
      const s = peopleOnAccount.get(acc) ?? new Set<string>();
      if (p.delivery_lead_id) s.add(str(p.delivery_lead_id));
      for (const pid of teamByProgramme.get(str(p.programme_id)) ?? []) s.add(pid);
      peopleOnAccount.set(acc, s);
    }
  }
  const channelRules = ((chanRes.data ?? []) as Row[]).map((r) => ({ blocked: strArr(r.blocked_channels), countries: strArr(r.country_codes) }));
  const sdrIds = eligible.filter((p) => p.app_role === "sdr").map((p) => p.person_id);

  const candidates: PlanCandidate[] = [];
  for (const m of memberships) {
    const c = contactById.get(str(m.contact_id));
    if (!c || c.contact_status !== "Active") continue;
    const a = accountById.get(str(c.account_id));
    if (!a) continue;
    const country = (c.country as string | null) ?? (a.country as string | null) ?? null;
    const avoid = new Set<string>(strArr(c.opt_out_channels));
    if (country) for (const r of channelRules) if (r.countries.includes(country)) r.blocked.forEach((b) => avoid.add(b));
    const link = new Set<string>([str(a.account_owner_id), str(a.outgrow_owner_id), str(c.primary_relationship_owner_id), ...(relsByContact.get(str(c.contact_id)) ?? []), ...(peopleOnAccount.get(str(c.account_id)) ?? [])]);
    if (SDR_LISTS.has(str(m.list_id))) sdrIds.forEach((id) => link.add(id));
    const reach = [...link].filter((id) => id && eligibleIds.has(id));
    if (!reach.length) continue;
    const lid = str(m.list_id);
    candidates.push({
      contact_id: str(c.contact_id), contact_name: `${str(c.first_name)} ${str(c.last_name)}`.trim(), contact_title: (c.job_title as string | null) ?? null,
      account_id: str(c.account_id), account_name: str(a.name), opportunity_id: (m.opportunity_id as string | null) ?? null,
      list_id: lid, list_name: listName.get(lid) ?? lid,
      default_play_id: listDefault.get(lid) && usablePlayIds.has(listDefault.get(lid)!) ? listDefault.get(lid)! : null,
      reason: str(m.reason).slice(0, 120), days_on_list: Math.max(0, daysBetween(str(m.entered_at).slice(0, 10), today)),
      avoid_channels: [...avoid], reach,
    });
  }

  return { weekStart: opts.weekStart, dueDate: dueDateFor(opts.weekStart), people, candidates, plays, focus, assignedContactIds, blockedCapabilityNames: blockedNames };
}

/* ------------------------------------------------------------------ prompt view: names, reasons and ids only. No money, no rapport, no contact details. */

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

export function toPromptInput(input: PlanInput): PlanPromptInput {
  const cands = capCandidates(input.candidates);
  const peopleById = new Map(input.people.map((p) => [p.person_id, p]));
  return {
    weekStart: input.weekStart, dueDate: input.dueDate,
    people: input.people.map((p) => ({ person_id: p.person_id, first_name: firstName(p.full_name), role: p.app_role, min: p.quota.min, max: p.quota.max, already: p.already, last_week_done: p.last_week.done, last_week_skipped: p.last_week.skipped })),
    candidates: cands.map((c) => ({
      contact_id: c.contact_id, contact: c.contact_name, title: c.contact_title, account: c.account_name, list_id: c.list_id, list: c.list_name, reason: c.reason,
      days_on_list: c.days_on_list, can_call: c.reach.filter((id) => peopleById.has(id)), avoid_channels: c.avoid_channels,
    })),
    plays: input.plays.map((p) => ({ play_id: p.play_id, title: p.title, action_code: p.action_code, priority: p.priority, lists: p.list_ids, idea: p.blurb })),
    focus: input.focus,
  };
}

/* ------------------------------------------------------------------ run */

export interface PlanRunResult {
  drafted: number; skipped: number; fromAi: number; fromRules: number; runId: string | null;
  source: "ai" | "ai+rules" | "rules" | "none";
  /** Why the plain rules were used instead of (or on top of) the model, in words a leader can read. */
  note: string | null;
  rejected: string[];
}

export interface PlanRunOptions {
  weekStart?: string;
  scopePersonIds?: string[];
  replace?: boolean;
  /** The signed-in person who asked (null for cron). Used for the run log and for who gets told. */
  personId: string | null;
  /** Tell managers and leaders that drafts are waiting (cron does; a person who just clicked Redraft is already looking). */
  notify: boolean;
}

export async function runPlanner(opts: PlanRunOptions): Promise<PlanRunResult> {
  const admin = createAdminClient();
  const weekStart = opts.weekStart ?? weekStartOf(todayIST());
  const replace = !!opts.replace;
  const input = await loadPlanInput(admin, { weekStart, scopePersonIds: opts.scopePersonIds, replace });

  if (!input.people.length) return { drafted: 0, skipped: 0, fromAi: 0, fromRules: 0, runId: null, source: "none", note: "Nobody on the roster is set up to take assignments.", rejected: [] };
  if (!input.candidates.length) return { drafted: 0, skipped: 0, fromAi: 0, fromRules: 0, runId: null, source: "none", note: "No contacts are on the lists yet, or nobody has a line to them. The daily job fills the lists; the library and roster need loading first.", rejected: [] };

  let accepted: PlannedAssignment[] = [];
  let rejected: string[] = [];
  let runId: string | null = null;
  let note: string | null = null;
  let fromAi = 0;

  const ai = await runJob("plan", planPrompt(toPromptInput(input)), {
    ctx: { personId: opts.personId, inputRef: { week: weekStart, people: input.people.length, candidates: input.candidates.length, replace } },
    schema: planOutputSchema,
  });
  if (ai.ok) {
    runId = ai.runId;
    const v = validatePlan(ai.data, input);
    accepted = v.accepted;
    fromAi = v.accepted.length;
    rejected = v.rejected.map((r) => r.reason);
    if (!v.accepted.length) note = "The AI's plan didn't pass the safety checks, so the plain rules were used.";
  } else {
    note = ai.message;
    runId = ai.runId;
  }

  // Top up: anyone still below their minimum gets plain-rule assignments (all the same checks). With no AI at all this is the whole plan.
  const after: PlanInput = {
    ...input,
    people: input.people.map((p) => ({ ...p, already: p.already + accepted.filter((a) => a.assignee_id === p.person_id).length })),
    assignedContactIds: [...input.assignedContactIds, ...accepted.map((a) => a.contact_id)],
  };
  const rules = validatePlan(heuristicPlan(after, ai.ok && accepted.length ? "min" : "goal"), after);
  accepted = [...accepted, ...rules.accepted];
  const fromRules = rules.accepted.length;
  if (ai.ok && accepted.length && fromRules > 0 && !note) note = "Some people were topped up with plain-rule assignments.";

  if (!accepted.length) return { drafted: 0, skipped: rejected.length, fromAi, fromRules, runId, source: "none", note: note ?? "Nothing new to plan this week.", rejected };

  const rows = accepted.map((a) => ({
    assignee_id: a.assignee_id, contact_id: a.contact_id, opportunity_id: a.opportunity_id, list_id: a.list_id, suggested_play_id: a.play_id,
    expected_action_code: a.expected_action_code, why_now: a.why_now, instruction: a.instruction, due_date: input.dueDate,
  }));
  // Rows the AI wrote are tied to its run (acceptance is tracked); rows from the plain rules are not.
  const aiRows = rows.slice(0, fromAi);
  const ruleRows = rows.slice(fromAi);
  const replaceFor = replace ? (opts.scopePersonIds ?? input.people.map((p) => p.person_id)) : null;
  let inserted = 0; let skipped = 0;
  for (const [batch, run, repl] of [[aiRows, runId, replaceFor], [ruleRows, null, replaceFor && !aiRows.length ? replaceFor : null]] as const) {
    if (!batch.length) continue;
    const { data, error } = await admin.rpc("save_planned_assignments", { p_week: weekStart, p_run: run, p_rows: batch, p_replace_for: repl });
    if (error) throw new Error(`save_planned_assignments failed: ${error.message}`);
    const r = data as { inserted?: number; skipped?: number };
    inserted += Number(r.inserted ?? 0); skipped += Number(r.skipped ?? 0);
  }
  // When a replace was requested but the AI batch was empty, the rules batch carried it (above). When both ran, the first call already replaced.

  if (opts.notify && inserted > 0) await notifyDrafts(admin, input, accepted, inserted).catch(() => undefined);
  const source = fromAi && fromRules ? "ai+rules" : fromAi ? "ai" : "rules";
  return { drafted: inserted, skipped: skipped + rejected.length, fromAi, fromRules, runId, source, note, rejected };
}

async function notifyDrafts(admin: Admin, input: PlanInput, accepted: PlannedAssignment[], total: number) {
  const managerOf = new Map(input.people.map((p) => [p.person_id, p.manager_id]));
  const perManager = new Map<string, number>();
  for (const a of accepted) { const m = managerOf.get(a.assignee_id); if (m) perManager.set(m, (perManager.get(m) ?? 0) + 1); }
  const { data: leaders } = await admin.from("acsia_people").select("person_id").eq("app_role", "leader").eq("active", true).is("archived_at", null);
  const rows: { person_id: string; kind: string; title: string; body: string; link: string }[] = [];
  const told = new Set<string>();
  for (const l of leaders ?? []) {
    told.add(String(l.person_id));
    rows.push({ person_id: String(l.person_id), kind: "plan", title: "Monday plan is ready to review", body: `${total} draft assignment${total === 1 ? "" : "s"} waiting for approval.`, link: "/team?tab=monday" });
  }
  for (const [m, n] of perManager) {
    if (told.has(m)) continue;
    rows.push({ person_id: m, kind: "plan", title: "Your team's Monday plan is ready", body: `${n} draft assignment${n === 1 ? "" : "s"} waiting for your approval.`, link: "/team?tab=monday" });
  }
  if (rows.length) await admin.from("notifications").insert(rows);
}
