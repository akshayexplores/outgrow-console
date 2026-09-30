import { describe, expect, it } from "vitest";
import { hasAmount, heuristicScore, mentions, nameablePeople, sentenceCount, toScorePrompt, validateScore, wordCount, type ScoreInput, type ScorePerson } from "@/lib/operator/score-core";

const p = (first: string, actions: number, extra: Partial<ScorePerson> = {}): ScorePerson => ({ first, full: `${first} Test`, actions, target: 5, streak: 0, participated: actions >= 5, codes: {}, ...extra });
const week = (people: ScorePerson[], extra: Partial<ScoreInput> = {}): ScoreInput => ({
  weekStart: "2026-09-21", people, story: null,
  totals: { total_actions: people.reduce((s, x) => s + x.actions, 0), participants: people.filter((x) => x.participated).length, roster_size: people.length, proposals_raised: 3, followups_made: 2, opps_created: 1 }, ...extra,
});
const base = week([p("Priya", 7, { codes: { "OG1.1": 3, "OG0.1": 4 } }), p("Arjun", 6), p("Meera", 2), p("Ravi", 0)]);
const good = { commentary: "Priya turned a routine sync into a LiLA walkthrough. Arjun chased three aged proposals nobody else would have.", story: "Priya raised a Did You Know and the customer asked for a walkthrough." };

describe("text checks", () => {
  it("counts sentences and words", () => {
    expect(sentenceCount("One. Two! Three?")).toBe(3);
    expect(sentenceCount("Just one sentence")).toBe(1);
    expect(sentenceCount("Dr. Who did it. Yes.")).toBe(3);
    expect(wordCount("  a  b c ")).toBe(3);
  });
  it("spots money and revenue words but not ordinary talk", () => {
    for (const t of ["worth $50,000", "a ₹12 lakh deal", "5k of pipeline", "USD 200", "closed won this week", "the revenue grew", "3 crore", "1.5m"]) expect(hasAmount(t), t).toBe(true);
    for (const t of ["chased 3 proposals", "5 meetings booked", "a good week", "took 2 calls"]) expect(hasAmount(t), t).toBe(false);
  });
  it("matches first names as whole words, case-insensitively", () => {
    expect(mentions("priya led", "Priya")).toBe(true);
    expect(mentions("Priyanka led", "Priya")).toBe(false);
    expect(mentions("Al led", "Al")).toBe(false);
  });
});

describe("who can be named", () => {
  it("excludes people with no activity, ambiguous first names and very short names", () => {
    const list = nameablePeople([p("Priya", 7), p("Arjun", 6), p("Sam", 3), p("Sam", 4), p("Ravi", 0), p("Al", 5)]);
    expect(list.map((x) => x.first)).toEqual(["Priya", "Arjun"]);
  });
  it("orders by actions", () => {
    expect(nameablePeople([p("Meera", 2), p("Priya", 7), p("Arjun", 6)]).map((x) => x.first)).toEqual(["Priya", "Arjun", "Meera"]);
  });
});

describe("validateScore", () => {
  it("accepts two sentences naming two roster people", () => {
    const r = validateScore(good, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.names.sort()).toEqual(["Arjun", "Priya"]);
  });
  const bad = (commentary: string, story = "", why: RegExp) => { const r = validateScore({ commentary, story }, base); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toMatch(why); };
  it("rejects wrong sentence count", () => {
    bad("Priya and Arjun did well.", "", /two sentences/);
    bad("Priya did well. Arjun did well. Meera did well.", "", /two sentences/);
  });
  it("rejects fewer than two names, and more than three", () => {
    bad("Priya did well. The team did well.", "", /two people/);
    const four = week([p("Priya", 7), p("Arjun", 6), p("Meera", 4), p("Kavya", 3)]);
    const r = validateScore({ commentary: "Priya, Arjun and Meera did well. Kavya helped too.", story: "" }, four);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too many/);
    const three = validateScore({ commentary: "Priya and Arjun did well. Meera helped too.", story: "" }, base);
    expect(three.ok).toBe(true);
  });
  it("rejects a name that is not on this week's nameable list", () => {
    bad("Ravi did well. Priya did well.", "", /two people/);
    bad("Zed did well. Yan did well.", "", /two people/);
  });
  it("rejects money, revenue, conversion rates, forecasts and things Acsia does not offer", () => {
    bad("Priya raised a $40,000 deal. Arjun chased proposals.", "", /money/);
    bad("Priya grew revenue. Arjun chased proposals.", "", /money/);
    bad("Priya has a 30% conversion rate. Arjun chased proposals.", "", /conversion/);
    bad("Priya will hit the forecast. Arjun chased proposals.", "", /conversion/);
    bad("Priya pitched ASIL D support. Arjun chased proposals.", "", /not offer/);
    bad(good.commentary, "Money made: $9,000 from the walkthrough.", /money/);
  });
  it("rejects a story over 40 words", () => {
    bad(good.commentary, Array.from({ length: 41 }, () => "word").join(" "), /40 words/);
  });
  it("accepts a story of exactly 40 words", () => {
    expect(validateScore({ commentary: good.commentary, story: Array.from({ length: 40 }, () => "word").join(" ") }, base).ok).toBe(true);
  });
});

describe("heuristicScore: facts only", () => {
  it("names the top two people and quotes the week's own numbers", () => {
    const d = heuristicScore(base)!;
    expect(d.commentary).toBe("Priya led the week with 7 actions and Arjun followed with 6. 2 of 4 people took part, with 3 proposals chased, 2 follow-ups made, 1 new opportunity opened.");
    expect(validateScore({ commentary: d.commentary, story: d.story }, base).ok).toBe(true);
  });
  it("uses singular forms, drops empty bits and breaks ties by first name", () => {
    const one = week([p("Priya", 1), p("Arjun", 1)], { totals: { total_actions: 2, participants: 0, roster_size: 2, proposals_raised: 0, followups_made: 0, opps_created: 0 } });
    expect(heuristicScore(one)!.commentary).toBe("Arjun led the week with 1 action and Priya followed with 1. 0 of 2 people took part.");
  });
  it("returns null when fewer than two people did anything", () => {
    expect(heuristicScore(week([p("Priya", 3), p("Arjun", 0)]))).toBeNull();
    expect(heuristicScore(week([]))).toBeNull();
  });
  it("strips amounts from the story line", () => {
    const d = heuristicScore({ ...base, story: { by: "Priya", text: "Priya got a $50,000 walkthrough approved" } })!;
    expect(d.story).not.toMatch(/\$|50,000/);
  });
});

describe("what the model is shown", () => {
  it("carries first names, counts and ask labels, and nothing money-like or personal", () => {
    const prompt = toScorePrompt({ ...base, story: { by: "Priya", text: "Won a $90,000 renewal thanks to a DYK" } });
    const json = JSON.stringify(prompt);
    expect(json).not.toMatch(/\$|90,000|revenue|pipeline|email|phone/i);
    expect(prompt.people[0]).toMatchObject({ first_name: "Priya", actions: 7 });
    expect(prompt.people[0]!.top_asks).toEqual(["3 × Did You Know"]);
    expect(prompt.people.some((x) => x.first_name === "Ravi")).toBe(false);
  });
});
