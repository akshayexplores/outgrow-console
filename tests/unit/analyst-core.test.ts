import { describe, expect, it } from "vitest";
import { actionLabel } from "@/lib/outgrow";
import {
  RATES_FROM_WEEK, allowedPercents, analystDataSchema, analystOutputSchema, filterAnalystText, heuristicAnalyst, toAnalystPrompt, type AnalystData,
} from "@/lib/operator/analyst-core";

const data = (over: Partial<AnalystData> = {}): AnalystData => ({
  programme_week: 14, rates_unlocked: true,
  by_code: [
    { code: "OG1.1", actions: 40, opportunities: 5, enough_data: true, rate: 0.125 },
    { code: "OG2.3", actions: 1, opportunities: 1, enough_data: false, rate: null },
  ],
  opps_by_stage: [], participation_by_week: [{ week_start: "2026-09-21", participation_rate: 0.4, total_actions: 22 }, { week_start: "2026-09-14", participation_rate: null, total_actions: null }],
  new_service_lines_bought_last_90_days: 2, ...over,
});

describe("input contract", () => {
  it("unlocks conversion rates from week 12", () => {
    expect(RATES_FROM_WEEK).toBe(12);
  });
  it("defaults the stage list and refuses malformed data", () => {
    const { opps_by_stage: _omit, ...rest } = data();
    expect(analystDataSchema.parse(rest).opps_by_stage).toEqual([]);
    expect(analystDataSchema.safeParse({ ...rest, programme_week: "x" }).success).toBe(false);
  });
  it("needs a real review and at most five watch items", () => {
    expect(analystOutputSchema.safeParse({ review: "too short" }).success).toBe(false);
    expect(analystOutputSchema.parse({ review: "A review that is long enough to keep." }).watch).toEqual([]);
    expect(analystOutputSchema.safeParse({ review: "A review that is long enough to keep.", watch: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
  });
});

describe("toAnalystPrompt", () => {
  it("turns rates into one-decimal percentages, keeps nulls, and labels codes", () => {
    const p = toAnalystPrompt(data({ by_code: [{ code: "OG1.1", actions: 40, opportunities: 5, enough_data: true, rate: 0.1234 }, { code: "OG2.3", actions: 1, opportunities: 0, enough_data: false, rate: null }] }));
    expect(p.by_code[0]).toMatchObject({ code: "OG1.1", label: actionLabel("OG1.1"), rate_percent: 12.3, enough_data: true });
    expect(p.by_code[1]!.rate_percent).toBeNull();
    expect(p.participation_by_week).toEqual([
      { week_start: "2026-09-21", participation_percent: 40, total_actions: 22 },
      { week_start: "2026-09-14", participation_percent: null, total_actions: 0 },
    ]);
    expect(p.new_service_lines_bought_last_90_days).toBe(2);
  });
  it("never includes money or account names", () => {
    expect(JSON.stringify(toAnalystPrompt(data()))).not.toMatch(/\$|revenue|account|contact/i);
  });
});

describe("allowedPercents", () => {
  it("allows only the database's own numbers, as given and rounded", () => {
    const a = allowedPercents(data());
    expect([...a].sort()).toEqual(["12.5", "13", "40"]);
  });
  it("is empty when there are no rates", () => {
    expect(allowedPercents(data({ by_code: [], participation_by_week: [] })).size).toBe(0);
  });
});

describe("filterAnalystText: the model only writes words", () => {
  const allowed = allowedPercents(data());
  it("keeps sentences that quote the database's percentages", () => {
    const r = filterAnalystText("Calls led to 12.5% opportunities. Participation was 40%. About 13% rounds nicely.", allowed);
    expect(r).toEqual({ text: "Calls led to 12.5% opportunities. Participation was 40%. About 13% rounds nicely.", removed: 0 });
  });
  it("drops sentences with a percentage the database never produced", () => {
    const r = filterAnalystText("Calls led to 12.5% opportunities. Visits led to 60% opportunities. Keep going.", allowed);
    expect(r.text).toBe("Calls led to 12.5% opportunities. Keep going.");
    expect(r.removed).toBe(1);
  });
  it("drops amounts of money and forecast language", () => {
    const r = filterAnalystText("Reviews went well. This is worth $5 million. We forecast strong growth. It will close soon. Projected uplift is high. Plain fact.", allowed);
    expect(r.text).toBe("Reviews went well. Plain fact.");
    expect(r.removed).toBe(4);
  });
  it("keeps line breaks and tidies blank runs", () => {
    const r = filterAnalystText("Line one.\n\nAn invented 99% claim.\n\n\nLine three.", allowed);
    expect(r.text).toBe("Line one.\n\nLine three.");
    expect(r.removed).toBe(1);
  });
  it("does not treat ordinary numbers as percentages", () => {
    expect(filterAnalystText("We logged 30 actions over 13 weeks.", allowed).removed).toBe(0);
  });
});

describe("heuristicAnalyst: facts only", () => {
  it("reports actions and traced opportunities, and only shows a rate with enough data", () => {
    const h = heuristicAnalyst(data());
    expect(h.review).toContain("Programme week 14.");
    expect(h.review).toContain(`**${actionLabel("OG1.1")}**: 40 actions, 5 traced opportunities; 12.5% of them led to an opportunity.`);
    expect(h.review).toContain(`**${actionLabel("OG2.3")}**: 1 action, 1 traced opportunity; not enough data yet for a rate.`);
    expect(h.review).toContain("2 new service lines moved");
    expect(h.review).toContain("not proof");
    expect(h.watch).toEqual([`${actionLabel("OG2.3")}: fewer than 30 actions, so no rate yet.`]);
  });
  it("copes with an empty quarter", () => {
    const h = heuristicAnalyst(data({ by_code: [], new_service_lines_bought_last_90_days: 1 }));
    expect(h.review).toContain("No actions have been logged in the last 13 weeks.");
    expect(h.review).toContain('1 new service line moved to "Buying from Acsia"');
    expect(h.watch).toEqual([]);
  });
  it("passes its own filter untouched", () => {
    const d = data();
    const h = heuristicAnalyst(d);
    expect(filterAnalystText(h.review, allowedPercents(d)).removed).toBe(0);
  });
});
