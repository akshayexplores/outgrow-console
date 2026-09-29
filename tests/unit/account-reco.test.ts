import { describe, expect, it } from "vitest";
import { recommend, type RecoInput } from "@/lib/account-reco";

const base: RecoInput = { daysSinceTouch: 10, coveragePct: 40, contacts: [{ name: "Dana Ruiz", days_since_touch: 10, strength: 4 }], needs: [], unknownServices: [], proposalsOverdue: [], singleThreaded: false };

describe("account recommendation (deterministic, one line)", () => {
  it("an overdue proposal beats everything else", () => {
    const r = recommend({ ...base, daysSinceTouch: 200, proposalsOverdue: [{ name: "Old", age_days: 70 }, { name: "Older", age_days: 90 }], needs: [{ service: "V&V", status: "Need likely" }] });
    expect(r).toContain("Older");
    expect(r).toContain("90 days");
  });
  it("no proactive call in 45+ days names the stalest contact", () => {
    const r = recommend({ ...base, daysSinceTouch: 80, contacts: [{ name: "Fresh", days_since_touch: 10, strength: 3 }, { name: "Stale", days_since_touch: 120, strength: 3 }] });
    expect(r).toContain("80 days");
    expect(r).toContain("Call Stale");
  });
  it("never touched: says so and asks for a first call", () => {
    expect(recommend({ ...base, daysSinceTouch: null, contacts: [] })).toContain("Nobody has made a proactive call here yet.");
    expect(recommend({ ...base, daysSinceTouch: null, contacts: [] })).toContain("Add a contact");
  });
  it("a live need is next", () => {
    expect(recommend({ ...base, needs: [{ service: "AUTOSAR", status: "Need likely" }] })).toContain("AUTOSAR looks like a live need");
  });
  it("thin coverage asks the open question", () => {
    expect(recommend({ ...base, coveragePct: 4 })).toContain("4% of the buying group");
  });
  it("single-threaded asks for an introduction", () => {
    expect(recommend({ ...base, singleThreaded: true })).toContain("second person");
  });
  it("otherwise: keep asking, and name the least-known service line", () => {
    expect(recommend({ ...base, unknownServices: ["Cybersecurity"] })).toContain("Cybersecurity");
    expect(recommend(base)).toContain("book the next conversation");
  });
  it("is a pure function", () => {
    expect(recommend(base)).toBe(recommend(base));
  });
});
