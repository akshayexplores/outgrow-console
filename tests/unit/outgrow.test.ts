import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTION_CODES, actionCount, addsOg01, allowedChannels, isParticipating, participationThreshold } from "@/lib/outgrow";

describe("participation (docs/02)", () => {
  it("threshold is least(5, weekly target)", () => {
    expect(participationThreshold(10)).toBe(5);
    expect(participationThreshold(3)).toBe(3);
    expect(participationThreshold(0)).toBe(0);
  });
  it("a target of zero never participates; otherwise actions >= threshold", () => {
    expect(isParticipating(9, 0)).toBe(false);
    expect(isParticipating(4, 10)).toBe(false);
    expect(isParticipating(5, 10)).toBe(true);
    expect(isParticipating(3, 3)).toBe(true);
  });
});

describe("action counting", () => {
  it("adds OG0.1 only for proactive calls and visits", () => {
    expect(actionCount("Proactive call", 2)).toBe(3);
    expect(actionCount("Voicemail + text", 0)).toBe(1);
    expect(actionCount("Scheduled meeting", 2)).toBe(2);
    expect(actionCount("Inbound (customer-initiated)", 1)).toBe(1);
    expect(addsOg01("Handwritten note")).toBe(false);
  });
});

describe("drift: the app's action codes match the shipped seed", () => {
  it("has exactly the same codes in the same order", () => {
    const seed = JSON.parse(readFileSync("seed/action_codes.json", "utf8")) as { code: string }[];
    expect(ACTION_CODES.map((a) => a.code)).toEqual(seed.map((a) => a.code));
  });
});

describe("channels", () => {
  it("removes opted-out and country-blocked channels from what may be suggested", () => {
    const rules = [{ geography: "South Korea", avoid: null, blocked_channels: ["WhatsApp"], country_codes: ["KR"] }];
    const ok = allowedChannels({ optOutChannels: ["SMS"], country: "KR", rules });
    expect(ok).not.toContain("WhatsApp");
    expect(ok).not.toContain("SMS");
    expect(ok).toContain("Call");
    expect(ok).not.toContain("Email" as never);
  });
});
