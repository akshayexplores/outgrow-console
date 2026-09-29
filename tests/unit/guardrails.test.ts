import { describe, expect, it } from "vitest";
import {
  SentenceGuard, coerceChannel, doNotOfferHits, hasConversionOrForecast, playIsUsable, scrubConversion, stripDealFields, stripMoney, stripPersonal,
} from "@/lib/operator/guardrails";

describe("money never reaches a model", () => {
  it("removes money-looking keys at any depth", () => {
    const out = stripMoney({ name: "A", revenue_ttm: 5, nested: { estimated_value_usd: 10, ok: 1 }, list: [{ competitor: "X", keep: 2 }] });
    expect(out).toEqual({ name: "A", nested: { ok: 1 }, list: [{ keep: 2 }] });
  });
  it("strips rapport and contact details for planner-style jobs", () => {
    expect(stripPersonal({ name: "A", rapport_notes: "x", interests: ["golf"], email: "a@b.c", role: "AE" })).toEqual({ name: "A", role: "AE" });
  });
});

describe("no conversion rates or forecasts", () => {
  it.each([
    "Our DYK conversion rate is high.",
    "About 30% of DYKs turn into proposals.",
    "This will likely close next quarter.",
    "Sales forecast looks strong.",
  ])("flags: %s", (t) => expect(hasConversionOrForecast(t)).toBe(true));
  it.each([
    "Ask what else they are working on.",
    "Book the next conversation for March.",
    "They said 40% of the work is with Acsia.",
  ])("allows: %s", (t) => expect(hasConversionOrForecast(t)).toBe(false));

  it("replaces only the offending sentence", () => {
    const r = scrubConversion("Open with the tester shortage. Our win rate is 20%. Then ask for a date.");
    expect(r.removed).toBe(1);
    expect(r.text).toContain("Open with the tester shortage.");
    expect(r.text).toContain("Then ask for a date.");
    expect(r.text).not.toMatch(/20%/);
  });
  it("holds streamed text until a sentence is complete", () => {
    const g = new SentenceGuard();
    expect(g.push("Open with the")).toBe("");
    const a = g.push(" shortage. The forecast is");
    expect(a).toBe("Open with the shortage.");
    const b = g.push(" strong. Then ask.") + g.flush();
    expect(b.startsWith(" (Removed")).toBe(true);
    expect(b).toContain("Removed");
    expect(b).toContain("Then ask.");
    expect(g.removed).toBe(1);
  });
});

describe("do-not-offer capabilities", () => {
  it("detects the built-in list and extra names", () => {
    expect(doNotOfferHits("we could do ASIL D and video processing")).toEqual(expect.arrayContaining(["ASIL C/D", "video processing"]));
    expect(doNotOfferHits("a hypervisor development project")).toContain("hypervisor development");
    expect(doNotOfferHits("Radar tuning please", ["radar tuning"])).toContain("radar tuning");
    expect(doNotOfferHits("AUTOSAR migration and ASIL B safety")).toEqual([]);
  });
  it("only approved plays that don't lead to a blocked capability are usable", () => {
    const blocked = new Set(["cap-x"]);
    expect(playIsUsable({ play_id: "1", approval_status: "Approved - internal" }, blocked)).toBe(true);
    expect(playIsUsable({ play_id: "2", approval_status: "Draft" }, blocked)).toBe(false);
    expect(playIsUsable({ play_id: "3", approval_status: "Approved - internal", to_capability_id: "cap-x" }, blocked)).toBe(false);
  });
});

describe("channels and deal fields", () => {
  it("coerces email and unknown channels to something allowed", () => {
    expect(coerceChannel("Email")).toBe("Call");
    expect(coerceChannel("whatsapp")).toBe("WhatsApp");
    expect(coerceChannel(undefined, "In person")).toBe("In person");
  });
  it("strips stage and owner from anything the model produced", () => {
    expect(stripDealFields({ name: "x", stage: "Won", owner_id: "u", status: "Need likely", estimated_value_usd: 5 })).toEqual({ name: "x", status: "Need likely", estimated_value_usd: 5 });
  });
});
