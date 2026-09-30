import { describe, expect, it } from "vitest";
import {
  LIST_ORDER, capCandidates, dueDateFor, heuristicPlan, mentionsBlockedChannel, oneLine, planOutputSchema, quotaFor, shortWhy, validatePlan,
  type PlanCandidate, type PlanInput, type PlanOutput, type PlanPerson, type PlanPlay,
} from "@/lib/operator/plan-core";

const person = (id: string, name: string, role: string, extra: Partial<PlanPerson> = {}): PlanPerson => ({
  person_id: id, full_name: name, app_role: role, manager_id: null, quota: quotaFor(role), already: 0, last_week: { done: 0, skipped: 0 }, ...extra,
});
const cand = (id: string, list: string, reach: string[], extra: Partial<PlanCandidate> = {}): PlanCandidate => ({
  contact_id: id, contact_name: `Contact ${id}`, contact_title: null, account_id: `acc-${id}`, account_name: `Account ${id}`, opportunity_id: null,
  list_id: list, list_name: list, default_play_id: null, reason: "reason", days_on_list: 10, avoid_channels: [], reach, ...extra,
});
const play = (id: string, code: string, lists: string[] = []): PlanPlay => ({ play_id: id, title: id, action_code: code, priority: "P1", list_ids: lists, blurb: "" });
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  weekStart: "2026-09-28", dueDate: "2026-10-02",
  people: [person("eng", "Ravi Engineer", "engineer"), person("ae", "Alia Ae", "ae"), person("pm", "Priya Pm", "pm")],
  candidates: [cand("c1", "L01", ["eng", "ae"]), cand("c2", "L05", ["eng"]), cand("c3", "A3", ["ae"]), cand("c4", "L03", ["pm", "ae"])],
  plays: [play("P-1", "OG2.3", ["L01"]), play("P-2", "OG1.2")], focus: null, assignedContactIds: [], blockedCapabilityNames: ["ASIL D"], ...over,
});
const out = (...a: PlanOutput["assignments"]): PlanOutput => ({ assignments: a });
const row = (assignee_id: string, contact_id: string, extra: Partial<PlanOutput["assignments"][number]> = {}) => ({ assignee_id, contact_id, instruction: "Ask them where the proposal stands.", why_now: "", ...extra });

describe("quotas and text hygiene", () => {
  it("gives sales 4-6 and everyone else 1-3", () => {
    expect(quotaFor("ae")).toEqual({ min: 4, max: 6 });
    expect(quotaFor("sdr")).toEqual({ min: 4, max: 6 });
    for (const r of ["engineer", "pm", "delivery_lead"]) expect(quotaFor(r)).toEqual({ min: 1, max: 3 });
  });
  it("cuts why-now to five words and strips trailing punctuation", () => {
    expect(shortWhy("Proposal has been waiting far too long now")).toBe("Proposal has been waiting far");
    expect(shortWhy("Renewal coming up.")).toBe("Renewal coming up");
    expect(shortWhy("  ")).toBe("");
  });
  it("keeps an instruction to one short line", () => {
    expect(oneLine("a\n\nb   c")).toBe("a b c");
    expect(oneLine("word ".repeat(200), 50).length).toBeLessThanOrEqual(50);
  });
  it("treats email as never allowed and respects word boundaries", () => {
    expect(mentionsBlockedChannel("Send an e-mail to Dana", [])).toBe("Email");
    expect(mentionsBlockedChannel("Email Dana", [])).toBe("Email");
    expect(mentionsBlockedChannel("Message her on WhatsApp", ["WhatsApp"])).toBe("WhatsApp");
    expect(mentionsBlockedChannel("Call Dana", ["Teams"])).toBeNull();
    expect(mentionsBlockedChannel("Ask about the callback", ["Call"])).toBeNull();
    expect(mentionsBlockedChannel("Call Dana", ["Call"])).toBe("Call");
  });
  it("computes Friday as the due date", () => {
    expect(dueDateFor("2026-09-28")).toBe("2026-10-02");
    expect(dueDateFor("2026-12-28")).toBe("2027-01-01");
  });
});

describe("output schema", () => {
  it("accepts the documented shape and defaults why_now", () => {
    const p = planOutputSchema.parse({ assignments: [{ assignee_id: "a", contact_id: "b", instruction: "Ask." }] });
    expect(p.assignments[0]!.why_now).toBe("");
  });
  it("refuses missing instruction or too many rows", () => {
    expect(planOutputSchema.safeParse({ assignments: [{ assignee_id: "a", contact_id: "b" }] }).success).toBe(false);
    expect(planOutputSchema.safeParse({ assignments: Array.from({ length: 201 }, () => ({ assignee_id: "a", contact_id: "b", instruction: "Ask." })) }).success).toBe(false);
  });
});

describe("validatePlan: every draft is re-checked in code", () => {
  it("accepts a good row and fills defaults from the list and the play", () => {
    const v = validatePlan(out(row("eng", "c1", { list_id: "L01", play_id: "P-1", why_now: "Proposal waiting for weeks now, chase" })), input());
    expect(v.rejected).toEqual([]);
    expect(v.accepted[0]).toMatchObject({ assignee_id: "eng", contact_id: "c1", account_id: "acc-c1", list_id: "L01", play_id: "P-1", expected_action_code: "OG2.3" });
    expect(v.accepted[0]!.why_now.split(" ").length).toBeLessThanOrEqual(5);
  });
  it("falls back to the list's default action code when there is no play", () => {
    const v = validatePlan(out(row("ae", "c3")), input());
    expect(v.accepted[0]!.expected_action_code).toBe("OG1.2");
    expect(v.accepted[0]!.why_now).toBe("Renewal coming up");
  });
  const rejects = (o: PlanOutput, expect_: RegExp, i: PlanInput = input()) => {
    const v = validatePlan(o, i);
    expect(v.accepted).toEqual([]);
    expect(v.rejected[0]!.reason).toMatch(expect_);
  };
  it("rejects an unknown assignee, a contact off the lists, and someone with no line to the contact", () => {
    rejects(out(row("ghost", "c1")), /assignee/);
    rejects(out(row("eng", "nope")), /not on any list/);
    rejects(out(row("pm", "c1")), /no line/);
  });
  it("rejects a second person on the same contact, and contacts already assigned this week", () => {
    const v = validatePlan(out(row("eng", "c1"), row("ae", "c1")), input());
    expect(v.accepted).toHaveLength(1);
    expect(v.rejected[0]!.reason).toMatch(/already has an assignment/);
    rejects(out(row("eng", "c1")), /already has an assignment/, input({ assignedContactIds: ["c1"] }));
  });
  it("rejects a play that is not in the approved, offerable set", () => {
    rejects(out(row("eng", "c1", { play_id: "P-UNKNOWN" })), /play/);
  });
  it("rejects do-not-offer capabilities, email, blocked channels, and conversion or forecast language", () => {
    rejects(out(row("eng", "c1", { instruction: "Offer ASIL D safety support to them." })), /does not offer/);
    rejects(out(row("eng", "c1", { instruction: "Offer video processing help." })), /does not offer/);
    rejects(out(row("eng", "c1", { instruction: "Send them an email about the proposal." })), /email/i);
    rejects(out(row("eng", "c1", { instruction: "Message on WhatsApp about the proposal." })), /WhatsApp/, input({ candidates: [cand("c1", "L01", ["eng"], { avoid_channels: ["WhatsApp"] })] }));
    rejects(out(row("eng", "c1", { instruction: "This has a 40% conversion rate, so chase it." })), /conversion/);
    rejects(out(row("eng", "c1", { instruction: "We expect to close this quarter, per the forecast." })), /conversion/);
  });
  it("rejects an empty instruction", () => {
    rejects(out(row("eng", "c1", { instruction: "  ok " })), /empty/);
  });
  it("enforces each person's weekly maximum, counting what they already have", () => {
    const many = input({ candidates: ["a", "b", "c", "d"].map((c) => cand(c, "L01", ["eng"])) });
    const v = validatePlan(out(row("eng", "a"), row("eng", "b"), row("eng", "c"), row("eng", "d")), many);
    expect(v.accepted).toHaveLength(3);
    expect(v.rejected[0]!.reason).toMatch(/limit/);
    const busy = input({ people: [person("eng", "Ravi Engineer", "engineer", { already: 3 })] });
    expect(validatePlan(out(row("eng", "c1")), busy).accepted).toHaveLength(0);
  });
});

describe("heuristicPlan: the plain-rules planner", () => {
  it("only ever produces rows that pass validation", () => {
    const i = input();
    const plan = heuristicPlan(i);
    const v = validatePlan(plan, i);
    expect(v.rejected).toEqual([]);
    expect(v.accepted.length).toBeGreaterThan(0);
  });
  it("puts the fastest-revenue lists first and uses the list's play", () => {
    const i = input({ candidates: [cand("low", "L04", ["ae"]), cand("high", "L01", ["ae"], { default_play_id: "P-1" }), cand("mid", "A3", ["ae"])] });
    const plan = heuristicPlan(i);
    expect(plan.assignments.map((a) => a.contact_id)).toEqual(["high", "mid", "low"]);
    expect(plan.assignments[0]!.play_id).toBe("P-1");
    expect(LIST_ORDER.indexOf("L01")).toBeLessThan(LIST_ORDER.indexOf("L04"));
  });
  it("spreads work across people who can all call, and never double-books a contact", () => {
    const i = input({ people: [person("a", "Ann Ae", "ae"), person("b", "Bo Ae", "ae")], candidates: Array.from({ length: 6 }, (_, k) => cand(`c${k}`, "L01", ["a", "b"])) });
    const plan = heuristicPlan(i);
    const per = (id: string) => plan.assignments.filter((x) => x.assignee_id === id).length;
    expect(per("a")).toBe(3);
    expect(per("b")).toBe(3);
    expect(new Set(plan.assignments.map((x) => x.contact_id)).size).toBe(plan.assignments.length);
  });
  it("gives delivery people two and sales five in a week, not the maximum", () => {
    const i = input({ people: [person("eng", "Ravi Engineer", "engineer"), person("ae", "Alia Ae", "ae")], candidates: [...Array.from({ length: 6 }, (_, k) => cand(`e${k}`, "L05", ["eng"])), ...Array.from({ length: 9 }, (_, k) => cand(`s${k}`, "L01", ["ae"]))] });
    const plan = heuristicPlan(i);
    expect(plan.assignments.filter((a) => a.assignee_id === "eng")).toHaveLength(2);
    expect(plan.assignments.filter((a) => a.assignee_id === "ae")).toHaveLength(5);
  });
  it("counts existing assignments and skips contacts already assigned", () => {
    const i = input({ people: [person("eng", "Ravi Engineer", "engineer", { already: 2 })], candidates: [cand("c1", "L01", ["eng"])] });
    expect(heuristicPlan(i).assignments).toHaveLength(0);
    const j = input({ people: [person("eng", "Ravi Engineer", "engineer")], candidates: [cand("c1", "L01", ["eng"])], assignedContactIds: ["c1"] });
    expect(heuristicPlan(j).assignments).toHaveLength(0);
  });
  it("in top-up mode only brings people up to their minimum", () => {
    const i = input({ people: [person("eng", "Ravi Engineer", "engineer", { already: 1 }), person("pm", "Priya Pm", "pm")], candidates: [cand("x", "L05", ["eng", "pm"]), cand("y", "L05", ["eng", "pm"])] });
    const plan = heuristicPlan(i, "min");
    expect(plan.assignments.map((a) => a.assignee_id)).toEqual(["pm"]);
  });
  it("never names a channel the contact avoids, even in its own wording", () => {
    const i = input({ candidates: [cand("c2", "L05", ["eng"], { avoid_channels: ["Call"] })] });
    const v = validatePlan(heuristicPlan(i), i);
    expect(v.rejected).toEqual([]);
    expect(v.accepted[0]!.instruction).not.toMatch(/\bcall\b/i);
  });
});

describe("capCandidates", () => {
  it("keeps the fastest-revenue lists and the longest-waiting contacts when trimming", () => {
    const many = [cand("old", "L04", ["a"], { days_on_list: 90 }), cand("prop", "L01", ["a"], { days_on_list: 1 }), cand("ren", "A3", ["a"], { days_on_list: 5 })];
    expect(capCandidates(many, 2).map((c) => c.contact_id)).toEqual(["prop", "ren"]);
  });
});
