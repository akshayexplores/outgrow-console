/**
 * The Friday scorecard writer's pure logic (docs/04 job 6). The scorecard goes to everyone on the roster, engineers included, so the draft:
 *   - names exactly the people the database will accept as "named" (active participants with a weekly target), by first name
 *   - carries no money, no revenue, no conversion rate or forecast, and nothing Acsia does not offer
 *   - is exactly two sentences, and the story is at most 40 words
 * A model draft that fails any check is replaced by a plain-facts draft built from the week's own numbers.
 */
import { z } from "zod";
import { actionLabel } from "@/lib/outgrow";
import { doNotOfferHits, hasConversionOrForecast } from "@/lib/operator/guardrails";
import type { ScorePromptInput } from "@/lib/operator/prompts";

export interface ScorePerson { first: string; full: string; actions: number; target: number; streak: number; participated: boolean; codes: Record<string, number> }
export interface ScoreInput {
  weekStart: string;
  totals: { total_actions: number; participants: number; roster_size: number; proposals_raised: number; followups_made: number; opps_created: number };
  people: ScorePerson[];
  /** All roster first names (participants), used to spot ambiguous names. */
  story: { by: string | null; text: string } | null;
}

export const scoreOutputSchema = z.object({ story: z.string().optional().default(""), commentary: z.string() });
export interface ScoreDraft { commentary: string; story: string; names: string[] }
/** What is kept next to the week (scorecard_weeks.ai_draft). `source` says whether the AI or the plain-facts fallback wrote it. */
export interface StoredDraft extends ScoreDraft { source: "ai" | "rules"; run_id: string | null; generated_at: string; note: string | null }

/* ------------------------------------------------------------------ text checks */

export const sentenceCount = (text: string) => text.trim().split(/(?<=[.!?])\s+/).filter((s) => /\w/.test(s)).length;
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Currency amounts and money-ish words. The scorecard is read by people who are not allowed to see revenue. */
const AMOUNT = /(?:[$€£₹]\s?\d|\b(?:usd|eur|inr|rs\.?)\s?\d|\b\d[\d,.]*\s?(?:k|m|mn|million|lakh|lakhs|crore|crores|cr)\b|\b(?:revenue|pipeline|deal\s+value|billing|billed|closed\s+won)\b)/i;
export const hasAmount = (text: string) => AMOUNT.test(text);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function mentions(text: string, first: string): boolean {
  const clean = first.replace(/[^\p{L}\p{N}]/gu, "");
  return clean.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(clean)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** First names unique among the roster people, so "Priya" in the text can only mean one person. */
export function nameablePeople(people: ScorePerson[]): ScorePerson[] {
  const seen = new Map<string, number>();
  for (const p of people) seen.set(p.first.toLowerCase(), (seen.get(p.first.toLowerCase()) ?? 0) + 1);
  return people
    .filter((p) => p.first.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 && seen.get(p.first.toLowerCase()) === 1 && (p.participated || p.actions > 0))
    .sort((a, b) => b.actions - a.actions || a.first.localeCompare(b.first));
}

const cleanLine = (s: string) => s.replace(/\s+/g, " ").trim();
const trimWords = (s: string, max: number) => { const w = cleanLine(s).split(" ").filter(Boolean); return w.length <= max ? w.join(" ") : w.slice(0, max).join(" ").replace(/[,;:\-–—]+$/, "") + "…"; };

/* ------------------------------------------------------------------ what the model may see */

export function toScorePrompt(i: ScoreInput): ScorePromptInput {
  const top = nameablePeople(i.people).slice(0, 8);
  return {
    weekStart: i.weekStart,
    totals: { total_actions: i.totals.total_actions, participants: i.totals.participants, roster_size: i.totals.roster_size, proposals_raised: i.totals.proposals_raised, followups_made: i.totals.followups_made, opportunities_created: i.totals.opps_created },
    people: top.map((p) => ({
      first_name: p.first, actions: p.actions, weekly_target: p.target, streak_weeks: p.streak,
      top_asks: Object.entries(p.codes).filter(([c]) => c !== "OG0.1").sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${n} × ${actionLabel(c)}`),
    })),
    story: i.story ? { by: i.story.by, text: trimWords(i.story.text.replace(new RegExp(AMOUNT.source, "gi"), ""), 60) } : null,
  };
}

/* ------------------------------------------------------------------ validation */

export type ScoreCheck = { ok: true; draft: ScoreDraft } | { ok: false; reason: string };

export function validateScore(raw: z.infer<typeof scoreOutputSchema>, input: ScoreInput, doNotOfferNames: string[] = []): ScoreCheck {
  const commentary = cleanLine(raw.commentary);
  const story = cleanLine(raw.story ?? "");
  const all = `${commentary} ${story}`;
  if (sentenceCount(commentary) !== 2) return { ok: false, reason: "commentary is not exactly two sentences" };
  if (commentary.length > 500) return { ok: false, reason: "commentary is too long" };
  if (wordCount(story) > 40) return { ok: false, reason: "story is over 40 words" };
  if (hasAmount(all)) return { ok: false, reason: "mentions money or an amount" };
  if (hasConversionOrForecast(all)) return { ok: false, reason: "quotes a conversion rate or forecast" };
  if (doNotOfferHits(all, doNotOfferNames).length) return { ok: false, reason: "mentions something Acsia does not offer" };
  const nameable = nameablePeople(input.people);
  const named = nameable.filter((p) => mentions(commentary, p.first));
  if (named.length < 2) return { ok: false, reason: "does not name two people from this week's roster" };
  if (named.length > 3) return { ok: false, reason: "names too many people" };
  return { ok: true, draft: { commentary, story, names: named.map((p) => p.first) } };
}

/* ------------------------------------------------------------------ plain-facts draft (no model) */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Built only from numbers that are on the scorecard already. Returns null when fewer than two people did anything to name. */
export function heuristicScore(input: ScoreInput): ScoreDraft | null {
  const [a, b] = nameablePeople(input.people).filter((p) => p.actions > 0);
  if (!a || !b) return null;
  const t = input.totals;
  const s1 = `${a.first} led the week with ${plural(a.actions, "action", "actions")} and ${b.first} followed with ${b.actions}.`;
  const bits = [t.proposals_raised > 0 ? `${plural(t.proposals_raised, "proposal", "proposals")} chased` : null, t.followups_made > 0 ? `${plural(t.followups_made, "follow-up", "follow-ups")} made` : null, t.opps_created > 0 ? `${plural(t.opps_created, "new opportunity", "new opportunities")} opened` : null].filter(Boolean);
  const s2 = `${t.participants} of ${t.roster_size} people took part${bits.length ? `, with ${bits.join(", ")}` : ""}.`;
  const story = input.story ? trimWords(input.story.text.replace(new RegExp(AMOUNT.source, "gi"), ""), 40) : "";
  const draft: ScoreDraft = { commentary: `${s1} ${s2}`, story, names: [a.first, b.first] };
  return draft;
}
