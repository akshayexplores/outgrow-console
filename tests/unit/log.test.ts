import { describe, expect, it } from "vitest";
import { buildLogPayload, checkDraft, draftActionCount, emptyDraft, hasErrors, logPayloadSchema, type ContactLite, type LogDraft } from "@/lib/log";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const contact: ContactLite = { contact_id: U(1), name: "Dana Whitfield", job_title: "Director", account_id: U(2), account_name: "Acme", country: "KR", account_country: "KR", opt_out_channels: ["WhatsApp"], contact_status: "Active" };
const short = (id: string) => (id === U(9) ? "NONE" : "TEL");
const rules = [{ geography: "South Korea", avoid: "Avoid WhatsApp; use KakaoTalk", blocked_channels: ["WhatsApp"], country_codes: ["KR"] }];

function draft(over: Partial<LogDraft> = {}): LogDraft {
  return { ...emptyDraft("2026-09-29"), contactId: U(1), accountId: U(2), asks: [{ key: "a", code: "OG1.2", service_line_id: U(3), value_usd: "60000", said: "need testers" }], ...over };
}

describe("Check screen", () => {
  it("passes a complete draft", () => {
    expect(hasErrors(checkDraft(draft(), contact, rules, short))).toBe(false);
  });
  it("blocks: no contact, no asks on a scheduled meeting, DYK on None, blank value", () => {
    expect(checkDraft(draft({ contactId: null }), null, rules, short).some((i) => i.field === "contact")).toBe(true);
    expect(hasErrors(checkDraft(draft({ touchType: "Scheduled meeting", asks: [] }), contact, rules, short))).toBe(true);
    expect(hasErrors(checkDraft(draft({ asks: [{ key: "a", code: "OG1.1", service_line_id: U(9), value_usd: "0", said: "" }] }), contact, rules, short))).toBe(true);
    expect(hasErrors(checkDraft(draft({ asks: [{ key: "a", code: "OG1.2", service_line_id: U(3), value_usd: "", said: "" }] }), contact, rules, short))).toBe(true);
  });
  it("a proactive call with no asks is valid (OG0.1 only)", () => {
    expect(hasErrors(checkDraft(draft({ asks: [] }), contact, rules, short))).toBe(false);
    expect(draftActionCount({ touchType: "Proactive call", asks: [] })).toBe(1);
    expect(draftActionCount({ touchType: "Scheduled meeting", asks: [{ key: "a", code: "OG2.2", service_line_id: U(3), value_usd: "0", said: "" }] })).toBe(1);
  });
  it("warns (never blocks) on opt-out and country rules", () => {
    const issues = checkDraft(draft({ channel: "WhatsApp" }), contact, rules, short);
    expect(issues.filter((i) => i.level === "warn").length).toBeGreaterThanOrEqual(2);
    expect(hasErrors(issues)).toBe(false);
  });
  it("warns, not blocks, on more than one Did You Know", () => {
    const two = draft({ asks: [1, 2].map((n) => ({ key: `k${n}`, code: "OG1.1", service_line_id: U(3), value_usd: "0", said: "" })) });
    const issues = checkDraft(two, contact, rules, short);
    expect(issues.some((i) => i.level === "warn" && /Did You Know/.test(i.message))).toBe(true);
    expect(hasErrors(issues)).toBe(false);
  });
  it("warns when a do-not-offer capability is mentioned", () => {
    const d = draft({ asks: [{ key: "a", code: "OG1.2", service_line_id: U(3), value_usd: "0", said: "they want ASIL D certification" }] });
    expect(checkDraft(d, contact, rules, short).some((i) => i.level === "warn" && /ASIL C\/D/.test(i.message))).toBe(true);
  });
  it("rejects email as a channel", () => {
    expect(hasErrors(checkDraft(draft({ channel: "Email" }), contact, rules, short))).toBe(true);
  });
});

describe("RPC payload", () => {
  it("builds a payload the server-side schema accepts", () => {
    const d = draft({
      note: "Good call", followUpDate: "2026-10-06", nominate: true, aiRunIds: [U(50)],
      follow: [
        { id: "f1", kind: "insight", text: "x", on: true, ask: 0, payload: { insight_type: "Pain point", text: "short on testers" } },
        { id: "f2", kind: "opportunity", text: "x", on: true, ask: 0, payload: { name: "AVB testers", service_line_id: U(3), expansion_lever: "More volume (same scope)", estimated_value_usd: 60000 } },
        { id: "f3", kind: "referral", text: "x", on: false, ask: 0, payload: { referred_name_text: "Priya" } },
      ],
    });
    const p = buildLogPayload(d);
    expect(p.follow_through.referrals).toHaveLength(0); // unchecked items are not sent
    expect(p.actions.every((a) => a.action_code !== "OG0.1")).toBe(true);
    expect(p.touch).toMatchObject({ capture_method: "Web", success_nominated: true });
    expect(logPayloadSchema.safeParse(p).success).toBe(true);
  });
  it("uses the text-to-manager capture method when it came from an inbox item", () => {
    const p = buildLogPayload(draft({ inboxId: U(7) }));
    expect(p.touch).toMatchObject({ capture_method: "Text to manager (AI-parsed)" });
    expect(p.inbox_id).toBe(U(7));
  });
  it("the schema refuses OG0.1, email and more than 12 asks", () => {
    const base = buildLogPayload(draft());
    expect(logPayloadSchema.safeParse({ ...base, actions: [{ action_code: "OG0.1", service_line_id: U(3), estimated_value_usd: 0 }] }).success).toBe(false);
    expect(logPayloadSchema.safeParse({ ...base, touch: { ...base.touch, channel: "Email" } }).success).toBe(false);
    const many = Array.from({ length: 13 }, () => ({ action_code: "OG2.2", service_line_id: U(3), estimated_value_usd: 0 }));
    expect(logPayloadSchema.safeParse({ ...base, actions: many }).success).toBe(false);
  });
});
