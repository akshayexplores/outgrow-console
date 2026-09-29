/**
 * Turns the (lenient, zod-validated) model output into the strict shapes the app uses. Pure and unit-tested.
 * The model may be wrong or creative; this is where its output is clamped to what the database and the Outgrow rules accept.
 */
import { z } from "zod";
import {
  ACTION_CODES, EXPANSION_LEVERS, INSIGHT_TYPES, SELECTABLE_ACTION_CODES, TOUCH_TYPE_VALUES, WHITESPACE_STATUSES, type Channel,
} from "@/lib/outgrow";
import { coerceChannel, stripDealFields } from "@/lib/operator/guardrails";
import type { FollowSuggestion, LogAsk } from "@/lib/log";

export interface ServiceLineLite { service_line_id: string; name: string; short_code: string }

/* ------------------------------------------------------------------ capture */

export const captureRawSchema = z.object({
  contact_id: z.string().nullable().optional(),
  touch_type: z.string().optional(),
  channel: z.string().optional(),
  actions: z.array(z.object({
    code: z.string(),
    service_line: z.string().optional().default("NONE"),
    value_usd: z.union([z.number(), z.string()]).optional().default(0),
    said: z.string().optional().default(""),
  })).default([]),
  follow_up_date: z.string().nullable().optional(),
  note_one_line: z.string().optional().default(""),
});
export type CaptureRaw = z.infer<typeof captureRawSchema>;

export interface ParsedLog {
  contact_id: string | null;
  touch_type: string;
  channel: Channel | string;
  asks: Omit<LogAsk, "key">[];
  follow_up_date: string | null;
  note: string;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve a model-written service line (short code, name, or fuzzy name) to a service_line_id. Unknown means "None / relationship only". */
export function resolveServiceLine(input: string, lines: ServiceLineLite[]): ServiceLineLite | undefined {
  const t = input.trim().toLowerCase();
  if (!t) return lines.find((l) => l.short_code === "NONE");
  return (
    lines.find((l) => l.short_code.toLowerCase() === t) ??
    lines.find((l) => l.name.toLowerCase() === t) ??
    lines.find((l) => l.name.toLowerCase().startsWith(t)) ??
    lines.find((l) => t.length >= 3 && l.name.toLowerCase().includes(t)) ??
    lines.find((l) => l.short_code === "NONE")
  );
}

export function normaliseCapture(raw: CaptureRaw, ctx: { lines: ServiceLineLite[]; candidateContactIds: ReadonlySet<string>; preselectedContactId?: string | null; today: string }): ParsedLog {
  const selectable = new Set(SELECTABLE_ACTION_CODES.map((a) => a.code));
  const asks: ParsedLog["asks"] = [];
  for (const a of raw.actions) {
    const code = a.code.trim().toUpperCase();
    if (!selectable.has(code)) continue; // unknown codes and OG0.1 (added by code, never by the model) are dropped
    const sl = resolveServiceLine(a.service_line, ctx.lines);
    if (!sl) continue;
    const num = typeof a.value_usd === "number" ? a.value_usd : Number(String(a.value_usd).replace(/[^0-9.]/g, ""));
    const value = Number.isFinite(num) && num > 0 ? Math.min(Math.round(num), 100_000_000) : 0;
    // A Did You Know on "None / relationship only" is invalid; it is kept as the model wrote it so the Check screen can flag it for the person.
    asks.push({ code, service_line_id: sl.service_line_id, value_usd: String(value), said: a.said.trim().slice(0, 400) });
    if (asks.length >= 12) break;
  }
  const cid = raw.contact_id && ctx.candidateContactIds.has(raw.contact_id) ? raw.contact_id : (ctx.preselectedContactId ?? null);
  const touchType = (TOUCH_TYPE_VALUES as string[]).find((t) => t.toLowerCase() === (raw.touch_type ?? "").trim().toLowerCase()) ?? "Proactive call";
  let follow: string | null = raw.follow_up_date && isoDate.test(raw.follow_up_date) ? raw.follow_up_date : null;
  if (follow && follow < ctx.today) follow = null;
  return { contact_id: cid, touch_type: touchType, channel: coerceChannel(raw.channel, "Call"), asks, follow_up_date: follow, note: raw.note_one_line.trim().slice(0, 300) };
}

/* ------------------------------------------------------------------ follow-through */

export const followRawSchema = z.object({
  suggestions: z.array(z.object({
    kind: z.string(),
    text: z.string().default(""),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
  })).default([]),
});
export type FollowRaw = z.infer<typeof followRawSchema>;

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 1_000_000_000) : 0;
};

let fid = 0;
const nextId = () => `f${Date.now().toString(36)}${(fid++).toString(36)}`;

/** Which ask a suggestion came from: the payload's own index if valid, else the first ask that fits its kind, else the first ask. */
function askIndexFor(kind: FollowSuggestion["kind"], payload: Record<string, unknown>, asks: { code: string }[]): number | null {
  if (asks.length === 0) return null;
  const given = Number(payload.from_action_index ?? payload.ask);
  if (Number.isInteger(given) && given >= 0 && given < asks.length) return given;
  const prefer: Record<string, string[]> = { referral: ["OG4.1", "OG4.2"], share_reading: ["OG3.1"], opportunity: ["OG1.2", "OG1.1", "OG2.1", "OG2.4"], whitespace: ["OG1.2", "OG1.1"], insight: ["OG1.2", "OG1.1"] };
  for (const c of prefer[kind] ?? []) { const i = asks.findIndex((a) => a.code === c); if (i >= 0) return i; }
  return 0;
}

export function normaliseFollow(raw: FollowRaw, ctx: { asks: { code: string; service_line_id: string }[]; lines: ServiceLineLite[]; hasContact: boolean }): FollowSuggestion[] {
  const out: FollowSuggestion[] = [];
  const noneId = ctx.lines.find((l) => l.short_code === "NONE")?.service_line_id;
  for (const s of raw.suggestions.slice(0, 8)) {
    const kind = s.kind.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const payload = stripDealFields(s.payload);
    const text = s.text.trim().slice(0, 240);
    const idx = (k: FollowSuggestion["kind"]) => askIndexFor(k, payload, ctx.asks);
    const sl = (): string | undefined => {
      const r = resolveServiceLine(str(payload.service_line ?? payload.service_line_id), ctx.lines);
      return r && r.service_line_id !== noneId ? r.service_line_id : undefined;
    };
    if (kind === "insight") {
      const t = str(payload.text, 500) || text;
      if (!t) continue;
      const type = (INSIGHT_TYPES as readonly string[]).find((x) => x.toLowerCase() === str(payload.insight_type).toLowerCase()) ?? "Talking point";
      const slid = sl();
      out.push({ id: nextId(), kind: "insight", text: t, on: true, ask: idx("insight"), payload: { insight_type: type, text: t, ...(slid ? { service_line_ids: [slid] } : {}) } });
    } else if (kind === "whitespace") {
      const slid = sl();
      if (!slid) continue;
      const status = (WHITESPACE_STATUSES as readonly string[]).find((x) => x.toLowerCase() === str(payload.status).toLowerCase()) ?? "Need likely";
      out.push({ id: nextId(), kind: "whitespace", text: text || `${ctx.lines.find((l) => l.service_line_id === slid)?.name ?? "Service line"}: ${status}`, on: true, ask: idx("whitespace"), payload: { service_line_id: slid, status, status_source: "rDYK answer" } });
    } else if (kind === "opportunity") {
      const name = str(payload.name, 200) || text;
      const slid = sl() ?? ctx.asks[idx("opportunity") ?? 0]?.service_line_id;
      if (!name || !slid || slid === noneId || ctx.asks.length === 0) continue;
      const lever = (EXPANSION_LEVERS as readonly string[]).find((x) => x.toLowerCase() === str(payload.expansion_lever).toLowerCase()) ?? "New service line (cross-sell)";
      const value = num(payload.estimated_value_usd);
      out.push({ id: nextId(), kind: "opportunity", text: text || name, on: true, ask: idx("opportunity"), payload: { name, service_line_id: slid, expansion_lever: lever, estimated_value_usd: value, ...(str(payload.next_step) ? { next_step: str(payload.next_step) } : {}) } });
    } else if (kind === "referral") {
      if (!ctx.hasContact || ctx.asks.length === 0) continue;
      out.push({ id: nextId(), kind: "referral", text: text || "Referral asked", on: true, ask: idx("referral"), payload: { referred_name_text: str(payload.referred_name_text ?? payload.name, 200) } });
    } else if (kind === "share_reading" || kind === "share" || kind === "share_of_wallet") {
      const pct = Number(payload.stated_share_pct ?? payload.share_pct);
      if (!ctx.hasContact || !Number.isFinite(pct) || pct < 0 || pct > 100 || ctx.asks.length === 0) continue;
      out.push({ id: nextId(), kind: "share_reading", text: text || `They said about ${pct}% of the work is with Acsia`, on: true, ask: idx("share_reading"), payload: { stated_share_pct: pct, scope: "All outsourced engineering", ...(str(payload.where_rest_goes) ? { where_rest_goes: str(payload.where_rest_goes) } : {}) } });
    }
  }
  return out.slice(0, 4);
}

export const actionLabelFor = (code: string) => ACTION_CODES.find((a) => a.code === code)?.label ?? code;
