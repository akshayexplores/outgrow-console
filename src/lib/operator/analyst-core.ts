/**
 * The quarterly analyst's pure logic (docs/04 job 9, hidden until programme week 12).
 * Every rate is computed by the database from actions and the opportunities traced to them; the model only writes the words.
 * Any sentence that quotes a percentage the database did not produce, an amount of money, or a forecast is removed before a person sees it.
 */
import { z } from "zod";
import { actionLabel } from "@/lib/outgrow";
import type { AnalystPromptInput } from "@/lib/operator/prompts";
import { hasAmount } from "@/lib/operator/score-core";

export const analystDataSchema = z.object({
  programme_week: z.number(),
  rates_unlocked: z.boolean(),
  by_code: z.array(z.object({ code: z.string(), actions: z.number(), opportunities: z.number(), enough_data: z.boolean(), rate: z.number().nullable() })),
  opps_by_stage: z.array(z.object({ stage: z.string(), count: z.number() })).default([]),
  participation_by_week: z.array(z.object({ week_start: z.string(), participation_rate: z.number().nullable(), total_actions: z.number().nullable() })),
  new_service_lines_bought_last_90_days: z.number(),
});
export type AnalystData = z.infer<typeof analystDataSchema>;

export const analystOutputSchema = z.object({ review: z.string().min(20), watch: z.array(z.string()).max(5).optional().default([]) });

/** Programme week from which conversion rates may be shown (PRD principle 7). */
export const RATES_FROM_WEEK = 12;

const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);

export function toAnalystPrompt(d: AnalystData): AnalystPromptInput {
  return {
    programme_week: d.programme_week,
    by_code: d.by_code.map((b) => ({ code: b.code, label: actionLabel(b.code), actions: b.actions, opportunities: b.opportunities, rate_percent: pct(b.rate), enough_data: b.enough_data })),
    participation_by_week: d.participation_by_week.map((w) => ({ week_start: w.week_start, participation_percent: pct(w.participation_rate), total_actions: w.total_actions ?? 0 })),
    new_service_lines_bought_last_90_days: d.new_service_lines_bought_last_90_days,
  };
}

/** Every percentage the model is allowed to say: the ones in its input, as given or rounded to a whole number. */
export function allowedPercents(d: AnalystData): Set<string> {
  const out = new Set<string>();
  const add = (r: number | null) => { const p = pct(r); if (p !== null) { out.add(String(p)); out.add(String(Math.round(p))); } };
  d.by_code.forEach((b) => add(b.rate));
  d.participation_by_week.forEach((w) => add(w.participation_rate));
  return out;
}

const FORECAST = /\b(?:forecast(?:ed|ing|s)?|projected|predicted|will\s+(?:close|convert|reach))\b/i;

/** Drops any sentence with an unknown percentage, an amount of money, or forecast language. Keeps the rest (and line breaks) as they were. */
export function filterAnalystText(text: string, allowed: ReadonlySet<string>): { text: string; removed: number } {
  let removed = 0;
  const lines = text.split("\n").map((line) => {
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((s) => {
      const bad = FORECAST.test(s) || hasAmount(s) || [...s.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].some((m) => !allowed.has(m[1]!) && !allowed.has(String(Math.round(Number(m[1]))))) ;
      if (bad) removed += 1;
      return !bad;
    });
    return kept.join(" ");
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** Plain-facts review from the same numbers, for when the model is off or its answer was unusable. */
export function heuristicAnalyst(d: AnalystData): { review: string; watch: string[] } {
  const rows = d.by_code.map((b) => {
    const rate = b.enough_data && b.rate !== null ? `${pct(b.rate)}% of them led to an opportunity` : "not enough data yet for a rate";
    return `- **${actionLabel(b.code)}**: ${b.actions} action${b.actions === 1 ? "" : "s"}, ${b.opportunities} traced opportunit${b.opportunities === 1 ? "y" : "ies"}; ${rate}.`;
  });
  const review = [
    `Programme week ${d.programme_week}. Here is what the last 13 weeks show, from the numbers alone.`,
    rows.length ? rows.join("\n") : "No actions have been logged in the last 13 weeks.",
    `${d.new_service_lines_bought_last_90_days} new service line${d.new_service_lines_bought_last_90_days === 1 ? "" : "s"} moved to "Buying from Acsia" in the last 90 days.`,
    "One quarter of numbers is a start, not proof. Read these as a direction and keep measuring.",
  ].join("\n\n");
  const watch = d.by_code.filter((b) => !b.enough_data).slice(0, 3).map((b) => `${actionLabel(b.code)}: fewer than 30 actions, so no rate yet.`);
  return { review, watch };
}
