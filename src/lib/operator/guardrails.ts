/**
 * Guardrails that run in code, before and after every model call (docs/04). Pure functions: no I/O, fully unit-tested.
 * The model never gets the chance to break these; it can only explain them.
 */
import { CHANNELS } from "@/lib/outgrow";

/* ------------------------------------------------------------------ 5. money never reaches a model unless the job lists it */

const MONEY_KEY = /(revenue|billed|billing|value_usd|estimated_value|est_annual|run_rate|budget|pipeline|competitor|spend|share_of_wallet|lifetime|ttm_|headcount_cost|rate_comparison)/i;

/** Deep copy with every money-looking key removed. Used on any context object before it is put into a prompt. */
export function stripMoney<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripMoney(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (MONEY_KEY.test(k)) continue;
      out[k] = stripMoney(v);
    }
    return out as T;
  }
  return value;
}

/** Keys that must never be sent to the planner / scorecard jobs (rapport notes are personal data). */
const RAPPORT_KEY = /(rapport|interests|current_priorities|strategic_notes|email|phone|mobile|linkedin|messaging_handle)/i;
export function stripPersonal<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripPersonal(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (RAPPORT_KEY.test(k)) continue;
      out[k] = stripPersonal(v);
    }
    return out as T;
  }
  return value;
}

/* ------------------------------------------------------------------ 6. no conversion rates or forecasts (except the analyst, from week 12) */

const CONVERSION_PATTERNS: RegExp[] = [
  /\b(conversion|close|closing|win|hit|success|strike)\s*rates?\b/i,
  /\b\d{1,3}(?:\.\d+)?\s?%\s*(?:of\s+(?:dyks?|rdyks?|pivots?|asks?|calls?|conversations?|swings?)|conversion|chance|probability|likelihood|likely|will\s+(?:buy|convert|close)|(?:of\s+the\s+time))/i,
  /\b(?:dyks?|rdyks?|pivots?)\b[^.\n]{0,40}\b\d{1,3}(?:\.\d+)?\s?%/i,
  /\bwill\s+(?:very\s+)?likely\s+(?:close|convert|buy)\b/i,
  /\b(?:sales\s+)?forecast(?:ed|ing|s)?\b/i,
  /\b(?:projected|expected|predicted)\s+(?:revenue|bookings|wins?|pipeline)\b/i,
  /\bexpect\s+to\s+(?:close|win)\b/i,
];

export function hasConversionOrForecast(text: string): boolean {
  return CONVERSION_PATTERNS.some((re) => re.test(text));
}

export const CONVERSION_REMOVED = "(Removed: Acsia hasn't measured conversion rates yet, so the console doesn't quote any.)";

/**
 * Streaming filter: releases text one sentence at a time and replaces any sentence that quotes a conversion rate or forecast.
 * Text already shown can't be taken back, so nothing is released until its sentence is complete.
 */
export class SentenceGuard {
  private buf = "";
  removed = 0;
  push(chunk: string): string {
    this.buf += chunk;
    let last = -1;
    const re = /[.!?](?=\s)|\n\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf)) !== null) last = m.index + m[0].length;
    if (last < 0) return "";
    const out = this.buf.slice(0, last);
    this.buf = this.buf.slice(last);
    return this.clean(out);
  }
  flush(): string {
    const out = this.buf;
    this.buf = "";
    return this.clean(out);
  }
  private clean(text: string): string {
    if (!text) return "";
    const lead = /^\s*/.exec(text)?.[0] ?? "";
    const parts = text.slice(lead.length).split(/(?<=[.!?])(\s+)/);
    let res = "";
    for (let i = 0; i < parts.length; i += 2) {
      const sentence = parts[i] ?? "";
      const gap = parts[i + 1] ?? "";
      if (sentence && hasConversionOrForecast(sentence)) { this.removed++; res += CONVERSION_REMOVED + gap; } else res += sentence + gap;
    }
    return lead + res;
  }
}

/** Whole-text version (non-streamed jobs). */
export function scrubConversion(text: string): { text: string; removed: number } {
  const g = new SentenceGuard();
  const out = g.push(text + " ") + g.flush();
  return { text: out.trimEnd(), removed: g.removed };
}

/* ------------------------------------------------------------------ 1. do-not-offer capabilities */

const DO_NOT_OFFER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bASIL[\s-]*(?:C|D)\b/i, label: "ASIL C/D" },
  { re: /\bvideo\s+(?:processing|codec|codecs|pipeline|streaming|encoding|decoding)\b/i, label: "video processing" },
  { re: /\baudio\s+(?:processing|codec|codecs|dsp|stack|development|tuning)\b/i, label: "audio" },
  { re: /\bhypervisor\s+(?:development|implementation|porting|stack)\b/i, label: "hypervisor development" },
  { re: /\bAUTOSAR\s+security\s+(?:implementation|stack|modules?)\b/i, label: "AUTOSAR security implementation" },
  { re: /\bperception\s+(?:algorithms?|stack|models?|software)\b/i, label: "perception algorithms" },
];

/** Names of the do-not-offer capabilities mentioned in a piece of text (built-in patterns + names from the capabilities table). */
export function doNotOfferHits(text: string, extraNames: string[] = []): string[] {
  const hits = new Set<string>();
  for (const p of DO_NOT_OFFER_PATTERNS) if (p.re.test(text)) hits.add(p.label);
  const lower = text.toLowerCase();
  for (const n of extraNames) if (n.length >= 4 && lower.includes(n.toLowerCase())) hits.add(n);
  return [...hits];
}

export const doNotOfferAdvice = (hit: string) => `${hit} isn't something Acsia offers. Don't pitch it: ask "who does that for you today?" instead.`;

export interface PlayLike { play_id: string; approval_status: string; requires_signoff?: boolean | null; to_capability_id?: string | null; from_capability_id?: string | null }

/** A play may reach the field only when it is approved and doesn't lead to a do-not-offer capability. (Rule 2 + rule 1.) */
export function playIsUsable(p: PlayLike, doNotOfferCapabilityIds: ReadonlySet<string>): boolean {
  if (!/^Approved/i.test(p.approval_status)) return false;
  if (p.to_capability_id && doNotOfferCapabilityIds.has(p.to_capability_id)) return false;
  return true;
}

/* ------------------------------------------------------------------ 3./4. channels: opt-outs, country rules, and email is never an action channel */

const CHANNEL_SET = new Set<string>(CHANNELS);
export function isActionChannel(c: string): boolean {
  return CHANNEL_SET.has(c);
}
/** Model output may name "Email" (or anything else); it is coerced to something the touches table accepts. */
export function coerceChannel(c: string | null | undefined, fallback = "Call"): string {
  if (!c) return fallback;
  const hit = [...CHANNEL_SET].find((x) => x.toLowerCase() === c.trim().toLowerCase());
  return hit ?? fallback;
}

/* ------------------------------------------------------------------ 7. the model never writes deal stage */

/** Deal-stage and ownership keys are stripped from every model-produced opportunity payload. Code sets stage = Identified and the owner. */
const FORBIDDEN_DEAL_KEYS = new Set(["stage", "deal_stage", "opportunity_stage", "owner_id", "owner", "closed_date", "lost_reason", "won_programme_id", "source_action_id", "origin"]);
export function stripDealFields<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!FORBIDDEN_DEAL_KEYS.has(k)) out[k] = v;
  return out as T;
}
