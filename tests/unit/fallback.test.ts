import { describe, expect, it } from "vitest";
import { guessFollowUp, guessServiceCode, guessTouch, guessValueUsd, heuristicCapture, heuristicFollow } from "@/lib/operator/fallback";
import type { ServiceLineLite } from "@/lib/operator/normalize";

const today = "2026-09-29"; // a Tuesday

describe("plain-form parser", () => {
  it("finds service lines and amounts", () => {
    expect(guessServiceCode("we talked about AVB testing on the TCU")).toBe("TEL");
    expect(guessServiceCode("their functional safety work")).toBe("FUSA");
    expect(guessServiceCode("hello")).toBe("NONE");
    expect(guessValueUsd("about $60k of work")).toBe(60000);
    expect(guessValueUsd("1.2m programme")).toBe(1_200_000);
    expect(guessValueUsd("two people from January")).toBe(0);
  });
  it("reads follow-up dates", () => {
    expect(guessFollowUp("call again tomorrow", today)).toBe("2026-09-30");
    expect(guessFollowUp("see him on Friday", today)).toBe("2026-10-02");
    expect(guessFollowUp("next week", today)).toBe("2026-10-05");
    expect(guessFollowUp("in 2 weeks", today)).toBe("2026-10-13");
    expect(guessFollowUp("12 Oct works", today)).toBe("2026-10-12");
    expect(guessFollowUp("nothing here", today)).toBeNull();
  });
  it("classifies the conversation", () => {
    expect(guessTouch("left a voicemail").touchType).toBe("Voicemail + text");
    expect(guessTouch("dropped by their office").touchType).toBe("Unscheduled visit (on site)");
    expect(guessTouch("the weekly sync meeting").touchType).toBe("Scheduled meeting");
    expect(guessTouch("rang Dana about tests").touchType).toBe("Proactive call");
  });
  it("turns a note into asks; never emits OG0.1; picks the one named contact", () => {
    const note = "Called Dana. They are short on testers for AVB and the rest goes to another vendor, about $60k. I mentioned we also do LiLA for test cases. Catch up next week.";
    const raw = heuristicCapture(note, { today, candidates: [{ id: "c1", name: "Dana Whitfield" }, { id: "c2", name: "Rahul Nair" }], preselectedContactId: null });
    const codes = raw.actions.map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["OG1.1", "OG1.2", "OG2.2"]));
    expect(codes).not.toContain("OG0.1");
    expect(raw.contact_id).toBe("c1");
    expect(raw.follow_up_date).toBe("2026-10-05");
    expect(raw.actions.find((a) => a.code === "OG1.2")?.value_usd).toBe(60000);
  });
  it("never leaves the person with an empty list", () => {
    expect(heuristicCapture("Chatted about the weather.", { today, candidates: [], preselectedContactId: null }).actions).toHaveLength(1);
  });
  it("suggests follow-through only from confirmed asks", () => {
    const lines: ServiceLineLite[] = [{ service_line_id: "1", name: "Telematics / Connectivity", short_code: "TEL" }];
    const f = heuristicFollow([{ index: 0, code: "OG1.2", service_line: "TEL", value_usd: 60000, said: "the rest goes to another vendor" }], lines);
    expect(f.suggestions.map((s) => s.kind)).toEqual(["insight", "whitespace", "opportunity"]);
    expect(f.suggestions.length).toBeLessThanOrEqual(4);
  });
});
