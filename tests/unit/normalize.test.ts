import { describe, expect, it } from "vitest";
import { captureRawSchema, followRawSchema, normaliseCapture, normaliseFollow, resolveServiceLine, type ServiceLineLite } from "@/lib/operator/normalize";
import { parseJsonLoose } from "@/lib/operator/json";

const lines: ServiceLineLite[] = [
  { service_line_id: "sl-fusa", name: "Functional Safety (ISO 26262, to ASIL B)", short_code: "FUSA" },
  { service_line_id: "sl-tel", name: "Telematics / Connectivity", short_code: "TEL" },
  { service_line_id: "sl-lila", name: "LiLA (agentic AI platform)", short_code: "LILA" },
  { service_line_id: "sl-none", name: "None / relationship only", short_code: "NONE" },
];
const ctx = { lines, candidateContactIds: new Set(["c1"]), preselectedContactId: null, today: "2026-09-29" };

describe("parseJsonLoose", () => {
  it("reads fenced JSON and JSON wrapped in prose", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! Here it is: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
    expect(parseJsonLoose("no json here")).toBeNull();
  });
});

describe("resolveServiceLine", () => {
  it("matches short code, name, prefix; unknown becomes None", () => {
    expect(resolveServiceLine("FUSA", lines)?.service_line_id).toBe("sl-fusa");
    expect(resolveServiceLine("telematics", lines)?.service_line_id).toBe("sl-tel");
    expect(resolveServiceLine("something odd", lines)?.service_line_id).toBe("sl-none");
    expect(resolveServiceLine("", lines)?.service_line_id).toBe("sl-none");
  });
});

describe("normaliseCapture", () => {
  it("drops OG0.1 and unknown codes, clamps values, coerces email to a real channel", () => {
    const raw = captureRawSchema.parse({
      contact_id: "c1", touch_type: "proactive call", channel: "Email",
      actions: [{ code: "OG0.1" }, { code: "og1.2", service_line: "TEL", value_usd: "$60,000", said: "we need two testers" }, { code: "XX9" }, { code: "OG2.2" }],
      follow_up_date: "2026-10-06", note_one_line: "Good call",
    });
    const p = normaliseCapture(raw, ctx);
    expect(p.asks.map((a) => a.code)).toEqual(["OG1.2", "OG2.2"]);
    expect(p.asks[0]).toMatchObject({ service_line_id: "sl-tel", value_usd: "60000" });
    expect(p.asks[1]).toMatchObject({ service_line_id: "sl-none", value_usd: "0" });
    expect(p.channel).toBe("Call");
    expect(p.touch_type).toBe("Proactive call");
    expect(p.follow_up_date).toBe("2026-10-06");
  });
  it("ignores contacts that weren't offered to the model and past follow-up dates", () => {
    const p = normaliseCapture(captureRawSchema.parse({ contact_id: "invented", actions: [], follow_up_date: "2020-01-01" }), { ...ctx, preselectedContactId: "c9" });
    expect(p.contact_id).toBe("c9");
    expect(p.follow_up_date).toBeNull();
  });
  it("caps asks at 12", () => {
    const actions = Array.from({ length: 20 }, () => ({ code: "OG2.2" }));
    expect(normaliseCapture(captureRawSchema.parse({ actions }), ctx).asks).toHaveLength(12);
  });
});

describe("normaliseFollow: the model never writes deal stage or owner", () => {
  const asks = [{ code: "OG1.2", service_line_id: "sl-tel" }, { code: "OG4.1", service_line_id: "sl-none" }];
  it("keeps supported kinds and strips stage/owner", () => {
    const raw = followRawSchema.parse({ suggestions: [
      { kind: "opportunity", text: "Two testers from January", payload: { name: "AVB/TSN testers", service_line: "TEL", estimated_value_usd: 60000, stage: "Won", owner_id: "x", from_action_index: 0 } },
      { kind: "whitespace", text: "FuSa held elsewhere", payload: { service_line: "FUSA", status: "Held by competitor" } },
      { kind: "referral", text: "Named a colleague", payload: { referred_name_text: "Priya" } },
      { kind: "made_up", text: "ignore me", payload: {} },
    ] });
    const out = normaliseFollow(raw, { asks, lines, hasContact: true });
    expect(out.map((f) => f.kind)).toEqual(["opportunity", "whitespace", "referral"]);
    const opp = out[0]!;
    expect(opp.payload).not.toHaveProperty("stage");
    expect(opp.payload).not.toHaveProperty("owner_id");
    expect(opp.payload).toMatchObject({ service_line_id: "sl-tel", estimated_value_usd: 60000 });
    expect(out[1]!.payload).toMatchObject({ service_line_id: "sl-fusa", status: "Held by competitor" });
  });
  it("skips whitespace on None, referrals without a contact, and share readings out of range", () => {
    const raw = followRawSchema.parse({ suggestions: [
      { kind: "whitespace", payload: { service_line: "NONE", status: "Need likely" } },
      { kind: "referral", payload: {} },
      { kind: "share_reading", payload: { stated_share_pct: 140 } },
    ] });
    expect(normaliseFollow(raw, { asks, lines, hasContact: false })).toEqual([]);
  });
  it("returns at most four suggestions", () => {
    const raw = followRawSchema.parse({ suggestions: Array.from({ length: 8 }, () => ({ kind: "insight", text: "x", payload: { text: "point" } })) });
    expect(normaliseFollow(raw, { asks, lines, hasContact: true })).toHaveLength(4);
  });
});
