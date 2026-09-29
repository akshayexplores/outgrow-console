import { describe, expect, it } from "vitest";
import { MIN_NAMED, namedPeople, publishBlockers } from "@/lib/scorecard";

const roster = ["Priya Menon", "Arjun Nair", "Lena Leader", "Al Short", "Sam Sdr"];

describe("namedPeople mirrors people_named_in()", () => {
  it("matches first names as whole words, case-insensitively", () => {
    expect(namedPeople("Great week: priya opened three doors and ARJUN followed up.", roster)).toEqual(["Priya Menon", "Arjun Nair"]);
  });
  it("does not match inside longer words", () => {
    expect(namedPeople("Priyanka joined the call", roster)).toEqual([]);
    expect(namedPeople("The samsung team", roster)).toEqual([]);
  });
  it("ignores first names shorter than 3 characters", () => {
    expect(namedPeople("Al did well", roster)).toEqual([]);
  });
  it("handles punctuation next to the name", () => {
    expect(namedPeople("Priya, Arjun. Lena!", roster)).toHaveLength(3);
  });
  it("counts each person once", () => {
    expect(namedPeople("Priya Priya Priya", roster)).toEqual(["Priya Menon"]);
  });
});

describe("publishBlockers", () => {
  const good = "Big week: Priya opened three conversations and Arjun followed every proposal.";
  it("no blockers when role, length and two names are present", () => {
    expect(publishBlockers(good, roster, true)).toEqual([]);
  });
  it("only the CEO or leader can publish", () => {
    expect(publishBlockers(good, roster, false)).toEqual(["Only the CEO or the Outgrow Leader can publish."]);
  });
  it("needs at least two named people", () => {
    const b = publishBlockers("A solid week from Priya and the wider team overall.", roster, true);
    expect(b).toHaveLength(1);
    expect(b[0]).toContain(`${MIN_NAMED} people`);
    expect(b[0]).toContain("1 so far");
  });
  it("needs real commentary", () => {
    expect(publishBlockers("Priya Arjun", roster, true)).toContain("Write two sentences of commentary.");
    expect(publishBlockers("", roster, true)).toHaveLength(2);
  });
});
