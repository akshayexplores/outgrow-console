/**
 * The Monday planner's pure logic (docs/04 job 5). No I/O here, so every rule is unit-tested:
 *   - who the planner may name, and how many assignments each person gets
 *   - the checks every draft must pass, whether the model or the plain rules wrote it
 *   - a rules-only planner used when the AI is off, over budget or fails (so Monday never starts empty)
 * The model is only ever shown ids, first names, short reasons and approved plays. Never money, rapport notes or contact details.
 */
import { z } from "zod";
import { doNotOfferHits, hasConversionOrForecast, playIsUsable } from "@/lib/operator/guardrails";

/** Roster roles that receive assignments from the planner (delivery people plus the sales roles). */
export const PLANNER_ROLES = ["engineer", "pm", "delivery_lead", "ae", "sdr"] as const;
export type PlannerRole = (typeof PLANNER_ROLES)[number];

/** docs/04: 1-3 per delivery person, 4-6 for AE / SDR. */
export function quotaFor(role: string): { min: number; max: number } {
  return role === "ae" || role === "sdr" ? { min: 4, max: 6 } : { min: 1, max: 3 };
}

export interface PlanPerson { person_id: string; full_name: string; app_role: string; manager_id: string | null; quota: { min: number; max: number }; already: number; last_week: { done: number; skipped: number } }
export interface PlanCandidate {
  contact_id: string; contact_name: string; contact_title: string | null; account_id: string; account_name: string; opportunity_id: string | null;
  list_id: string; list_name: string; default_play_id: string | null; reason: string; days_on_list: number;
  /** Channels this contact must not be offered: their opt-outs plus the country's blocked channels. */
  avoid_channels: string[];
  /** Roster people who can legitimately make this call (programme team, account owner, relationship owner). */
  reach: string[];
}
export interface PlanPlay { play_id: string; title: string; action_code: string; priority: string; list_ids: string[]; blurb: string }
export interface PlanFocus { dyk_focus_play_ids: string[]; referral_focus: string | null; questions: string[] }
export interface PlanInput {
  weekStart: string; dueDate: string; people: PlanPerson[]; candidates: PlanCandidate[]; plays: PlanPlay[]; focus: PlanFocus | null;
  /** Contacts that already have a live assignment this week (any assignee), so nobody is asked to call them twice. */
  assignedContactIds: string[]; blockedCapabilityNames: string[];
}

export interface PlannedAssignment {
  assignee_id: string; contact_id: string; account_id: string; opportunity_id: string | null; list_id: string | null;
  play_id: string | null; expected_action_code: string | null; why_now: string; instruction: string;
}

export const planOutputSchema = z.object({
  assignments: z.array(z.object({
    assignee_id: z.string(), contact_id: z.string(), list_id: z.string().nullable().optional(), play_id: z.string().nullable().optional(),
    why_now: z.string().optional().default(""), instruction: z.string(),
  })).max(200),
});
export type PlanOutput = z.infer<typeof planOutputSchema>;

/* ------------------------------------------------------------------ text hygiene */

/** "why now" is at most five words (docs/04). */
export function shortWhy(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 5);
  return words.join(" ").replace(/[.,;:!\-–—]+$/, "");
}
/** One sentence on one line, capped so a rambling answer can't fill the card. */
export function oneLine(text: string, max = 300): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** True when the text names a channel the contact opted out of (or the country blocks). Email is never an action channel. */
export function mentionsBlockedChannel(text: string, avoid: string[]): string | null {
  for (const ch of ["Email", ...avoid]) {
    if (!ch) continue;
    const re = ch.toLowerCase() === "email" ? /\be-?mail\b/i : new RegExp(`\\b${escapeRe(ch)}\\b`, "i");
    if (re.test(text)) return ch;
  }
  return null;
}

/* ------------------------------------------------------------------ validation: every draft, whoever wrote it */

export interface Rejected { index: number; reason: string }
export interface Validated { accepted: PlannedAssignment[]; rejected: Rejected[] }

export function validatePlan(output: PlanOutput, input: PlanInput): Validated {
  const people = new Map(input.people.map((p) => [p.person_id, p]));
  const playById = new Map(input.plays.map((p) => [p.play_id, p]));
  const byContact = new Map<string, PlanCandidate[]>();
  for (const c of input.candidates) byContact.set(c.contact_id, [...(byContact.get(c.contact_id) ?? []), c]);
  const taken = new Set(input.assignedContactIds);
  const perPerson = new Map<string, number>(input.people.map((p) => [p.person_id, p.already]));
  const accepted: PlannedAssignment[] = [];
  const rejected: Rejected[] = [];

  output.assignments.forEach((a, index) => {
    const no = (reason: string) => { rejected.push({ index, reason }); };
    const person = people.get(a.assignee_id);
    if (!person) return no("unknown or inactive assignee");
    const options = byContact.get(a.contact_id);
    if (!options) return no("contact is not on any list this week");
    const cand = (a.list_id ? options.find((c) => c.list_id === a.list_id) : undefined) ?? options[0]!;
    if (!cand.reach.includes(person.person_id)) return no("assignee has no line to this contact");
    if (taken.has(cand.contact_id)) return no("contact already has an assignment this week");
    const play = a.play_id ? playById.get(a.play_id) : undefined;
    if (a.play_id && !play) return no("play is not approved or is not offerable");
    const text = `${a.instruction} ${a.why_now ?? ""}`;
    const dno = doNotOfferHits(text, input.blockedCapabilityNames);
    if (dno.length) return no(`mentions something Acsia does not offer (${dno[0]})`);
    const ch = mentionsBlockedChannel(text, cand.avoid_channels);
    if (ch) return no(`suggests ${ch}, which is not allowed for this contact`);
    if (hasConversionOrForecast(text)) return no("quotes a conversion rate or forecast");
    const instruction = oneLine(a.instruction);
    if (instruction.length < 8) return no("instruction is empty");
    if ((perPerson.get(person.person_id) ?? 0) >= person.quota.max) return no("over this person's weekly limit");

    perPerson.set(person.person_id, (perPerson.get(person.person_id) ?? 0) + 1);
    taken.add(cand.contact_id);
    accepted.push({
      assignee_id: person.person_id, contact_id: cand.contact_id, account_id: cand.account_id, opportunity_id: cand.opportunity_id, list_id: cand.list_id,
      play_id: play?.play_id ?? null, expected_action_code: play?.action_code ?? DEFAULT_CODE[cand.list_id] ?? "OG1.2",
      why_now: shortWhy(a.why_now || WHY[cand.list_id] || cand.reason), instruction,
    });
  });
  return { accepted, rejected };
}

/* ------------------------------------------------------------------ the rules-only planner */

/** Fastest-revenue lists first (docs/02: proposals outstanding are "the fastest revenue in the system"). */
export const LIST_ORDER = ["L01", "L02", "A3", "L09", "L03", "A1", "L05", "L04"];
const DEFAULT_CODE: Record<string, string> = { L01: "OG2.3", L02: "OG2.4", A3: "OG1.2", L09: "OG1.2", L03: "OG1.2", A1: "OG1.2", L05: "OG1.2", L04: "OG1.2" };
const WHY: Record<string, string> = {
  L01: "Proposal waiting, chase it", L02: "Stalled before a proposal", A3: "Renewal coming up", L09: "Warm lead worth revisiting",
  L03: "Room to grow here", A1: "Reach the wider group", L05: "Gone quiet, reconnect", L04: "Could buy more",
};
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function instructionFor(c: PlanCandidate): string {
  const n = first(c.contact_name);
  switch (c.list_id) {
    case "L01": return `Ask ${n} where the proposal stands and what would help it move.`;
    case "L02": return `Ask ${n} whether they are ready for a proposal on the scope you discussed.`;
    case "L09": return `Ask ${n} whether the timing has changed on the work you discussed.`;
    case "A3": return `Ask ${n} how the programme is going and what they will need at renewal.`;
    case "L05": return `Reach ${n} with no agenda: ask what is new and what else they are working on.`;
    default: return `Ask ${n} what else they are working on and who else on their side we could be helping.`;
  }
}

/** Approved play for a list: the list's default if usable, else the first usable play that names the list. */
export function pickPlay(c: PlanCandidate, plays: PlanPlay[]): PlanPlay | null {
  const byId = new Map(plays.map((p) => [p.play_id, p]));
  if (c.default_play_id && byId.has(c.default_play_id)) return byId.get(c.default_play_id)!;
  return plays.find((p) => p.list_ids.includes(c.list_id)) ?? null;
}

/**
 * "goal": a week's worth for someone with nobody else planning for them (two calls for delivery people, five for sales).
 * "min": only bring people who are below their minimum up to it, used to top up a model's plan.
 */
export function heuristicPlan(input: PlanInput, mode: "goal" | "min" = "goal"): PlanOutput {
  const rank = (id: string) => { const i = LIST_ORDER.indexOf(id); return i < 0 ? 99 : i; };
  const sorted = [...input.candidates].sort((a, b) => rank(a.list_id) - rank(b.list_id) || b.days_on_list - a.days_on_list || a.contact_name.localeCompare(b.contact_name));
  const taken = new Set(input.assignedContactIds);
  const load = new Map(input.people.map((p) => [p.person_id, p.already]));
  const goal = (p: PlanPerson) => (mode === "min" ? p.quota.min : Math.min(p.quota.max >= 4 ? 5 : 2, p.quota.max)); // a week's worth, not a quota to max out
  const out: PlanOutput["assignments"] = [];
  for (const cand of sorted) {
    if (taken.has(cand.contact_id)) continue;
    const eligible = input.people
      .filter((p) => cand.reach.includes(p.person_id) && (load.get(p.person_id) ?? 0) < goal(p))
      .sort((a, b) => (load.get(a.person_id) ?? 0) - (load.get(b.person_id) ?? 0) || a.full_name.localeCompare(b.full_name));
    const who = eligible[0];
    if (!who) continue;
    const play = pickPlay(cand, input.plays);
    load.set(who.person_id, (load.get(who.person_id) ?? 0) + 1);
    taken.add(cand.contact_id);
    out.push({ assignee_id: who.person_id, contact_id: cand.contact_id, list_id: cand.list_id, play_id: play?.play_id ?? null, why_now: WHY[cand.list_id] ?? cand.reason, instruction: instructionFor(cand) });
  }
  return { assignments: out };
}

/** Friday of the week (assignments fall due at the end of the working week). */
export function dueDateFor(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4);
  return d.toISOString().slice(0, 10);
}

/** Which plays a model may pick from: approved, and not leading to a do-not-offer capability. */
export function usablePlays<T extends { play_id: string; approval_status: string; to_capability_id?: string | null }>(plays: T[], blockedCapabilityIds: ReadonlySet<string>): T[] {
  return plays.filter((p) => playIsUsable(p, blockedCapabilityIds));
}

/** Trim the candidate list the model sees: fastest-revenue lists first, then longest waiting, capped so the prompt stays small. */
export function capCandidates(cands: PlanCandidate[], max = 120): PlanCandidate[] {
  const rank = (id: string) => { const i = LIST_ORDER.indexOf(id); return i < 0 ? 99 : i; };
  return [...cands].sort((a, b) => rank(a.list_id) - rank(b.list_id) || b.days_on_list - a.days_on_list).slice(0, max);
}
