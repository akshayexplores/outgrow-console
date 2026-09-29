/**
 * The log flow's shared model (client + server, no I/O): the draft the person edits on the Check screen,
 * the payload sent to the log_conversation RPC, and client-side validation that mirrors the RPC's rules.
 */
import { z } from "zod";
import {
  ACTION_CODE_VALUES, CHANNELS, EXPANSION_LEVERS, INSIGHT_TYPES, TOUCH_TYPE_VALUES, WHITESPACE_STATUSES,
  actionCount, addsOg01, channelWarnings, type ChannelRuleLite, type ChannelWarning,
} from "@/lib/outgrow";
import { doNotOfferHits } from "@/lib/operator/guardrails";

export interface LogAsk { key: string; code: string; service_line_id: string; value_usd: string; said: string }

export type FollowKind = "insight" | "whitespace" | "opportunity" | "referral" | "share_reading";
/** A suggestion from the operator. `payload` already has the RPC's shape; `ask` is the index into the asks list it came from. */
export interface FollowSuggestion { id: string; kind: FollowKind; text: string; on: boolean; ask: number | null; payload: Record<string, unknown> }

export interface LogDraft {
  contactId: string | null;
  accountId: string | null;
  touchType: string;
  channel: string;
  touchDate: string;
  followUpDate: string;
  note: string;
  nominate: boolean;
  asks: LogAsk[];
  follow: FollowSuggestion[];
  rawText: string;
  personId: string | null; // proxy: credit goes to this person
  assignmentId: string | null;
  inboxId: string | null;
  aiRunIds: string[];
  aiParsed: boolean;
}

export const emptyDraft = (today: string): LogDraft => ({
  contactId: null, accountId: null, touchType: "Proactive call", channel: "Call", touchDate: today, followUpDate: "", note: "", nominate: false,
  asks: [], follow: [], rawText: "", personId: null, assignmentId: null, inboxId: null, aiRunIds: [], aiParsed: false,
});

let seq = 0;
export const newAskKey = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Contact facts the Check screen needs for warnings. */
export interface ContactLite {
  contact_id: string; name: string; job_title: string | null; account_id: string; account_name: string;
  country: string | null; account_country: string | null; opt_out_channels: string[] | null; contact_status: string | null;
  preferred_channel?: string | null;
}

export interface CheckIssue { level: "error" | "warn"; message: string; field?: string }

export function draftActionCount(d: Pick<LogDraft, "touchType" | "asks">): number {
  return actionCount(d.touchType, d.asks.length);
}

/**
 * Everything the Check screen shows as a warning or blocks Save on. Errors mirror the RPC's own rules so people find out before Save;
 * warnings (opt-outs, country avoid-lists, more than one Did You Know) never block.
 */
export function checkDraft(d: LogDraft, contact: ContactLite | null, rules: ChannelRuleLite[], serviceLineShort: (id: string) => string, doNotOfferNames: string[] = []): CheckIssue[] {
  const out: CheckIssue[] = [];
  if (!d.contactId || !d.accountId) out.push({ level: "error", message: "Choose who you spoke to.", field: "contact" });
  if (!(TOUCH_TYPE_VALUES as string[]).includes(d.touchType)) out.push({ level: "error", message: "Choose the conversation type.", field: "touchType" });
  if (!(CHANNELS as readonly string[]).includes(d.channel)) out.push({ level: "error", message: "Email is not an action channel. Choose how the conversation happened.", field: "channel" });
  if (d.asks.length === 0 && !addsOg01(d.touchType)) out.push({ level: "error", message: "Add at least one ask. A scheduled or inbound conversation only counts through the asks inside it.", field: "asks" });
  if (d.asks.length > 12) out.push({ level: "error", message: "At most 12 asks in one conversation.", field: "asks" });
  d.asks.forEach((a, i) => {
    const n = i + 1;
    if (!(ACTION_CODE_VALUES as string[]).includes(a.code) || a.code === "OG0.1") out.push({ level: "error", message: `Ask ${n}: choose an action. OG0.1 is added for you.`, field: `ask-${a.key}` });
    if (!a.service_line_id) out.push({ level: "error", message: `Ask ${n}: choose a service line.`, field: `ask-${a.key}` });
    else if (a.code === "OG1.1" && serviceLineShort(a.service_line_id) === "NONE") out.push({ level: "error", message: `Ask ${n}: a Did You Know must name something the customer can pay for.`, field: `ask-${a.key}` });
    const v = a.value_usd.trim();
    if (v === "" || !Number.isFinite(Number(v)) || Number(v) < 0) out.push({ level: "error", message: `Ask ${n}: give a value. A rough guess is fine, and 0 is valid.`, field: `ask-${a.key}` });
    for (const hit of doNotOfferHits(a.said, doNotOfferNames)) out.push({ level: "warn", message: `Ask ${n}: ${hit} isn't something Acsia offers. Don't pitch it; ask who does it for them today.`, field: `ask-${a.key}` });
  });
  const dyks = d.asks.filter((a) => a.code === "OG1.1").length;
  if (dyks > 1) out.push({ level: "warn", message: `${dyks} Did You Knows in one conversation. The Outgrow rule is one DYK per conversation; keep only the one you actually raised.` });
  if (d.touchDate) {
    // date sanity mirrors the RPC (not in the future; not older than 30 days). "today" is passed in by the caller through touchDate max/min, so only shape is checked here.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.touchDate)) out.push({ level: "error", message: "Use a valid conversation date.", field: "touchDate" });
  }
  if (contact) {
    const warns: ChannelWarning[] = channelWarnings({
      channel: d.channel, touchType: d.touchType, contactName: contact.name, contactCountry: contact.country, accountCountry: contact.account_country,
      optOutChannels: contact.opt_out_channels, contactStatus: contact.contact_status, rules, asks: d.asks.length,
    });
    for (const w of warns) if (w.code !== "NOT_PROACTIVE") out.push({ level: "warn", message: w.message });
  }
  return out;
}

export const hasErrors = (issues: CheckIssue[]) => issues.some((i) => i.level === "error");

/* ------------------------------------------------------------------ RPC payload */

export interface LogRpcPayload {
  touch: Record<string, unknown>;
  actions: Record<string, unknown>[];
  follow_through: { insights: unknown[]; whitespace: unknown[]; opportunities: unknown[]; referrals: unknown[]; share_reading?: unknown };
  inbox_id?: string;
  ai_run_ids?: string[];
}

export function buildLogPayload(d: LogDraft): LogRpcPayload {
  const asks = d.asks.map((a) => ({
    action_code: a.code, service_line_id: a.service_line_id, estimated_value_usd: Number(a.value_usd) || 0,
    customer_answer: a.said.trim() ? a.said.trim().slice(0, 600) : null,
  }));
  const on = d.follow.filter((f) => f.on);
  const p = (f: FollowSuggestion) => ({ ...f.payload, from_action_index: f.ask ?? 0 });
  const share = on.find((f) => f.kind === "share_reading");
  const capture = d.inboxId ? "Text to manager (AI-parsed)" : "Web";
  return {
    touch: {
      touch_date: d.touchDate || undefined, person_id: d.personId ?? undefined, account_id: d.accountId, contact_id: d.contactId,
      touch_type: d.touchType, channel: d.channel, note: d.note.trim() || undefined, follow_up_date: d.followUpDate || undefined,
      assignment_id: d.assignmentId ?? undefined, success_nominated: d.nominate, capture_method: capture, raw_capture_text: d.rawText.trim() ? d.rawText.trim().slice(0, 2000) : undefined,
    },
    actions: asks,
    follow_through: {
      insights: on.filter((f) => f.kind === "insight").map((f) => ({ ...f.payload, text: String(f.payload.text ?? f.text), ai_extracted: true })),
      whitespace: on.filter((f) => f.kind === "whitespace").map(p),
      opportunities: on.filter((f) => f.kind === "opportunity").map(p),
      referrals: on.filter((f) => f.kind === "referral").map(p),
      ...(share ? { share_reading: p(share) } : {}),
    },
    ...(d.inboxId ? { inbox_id: d.inboxId } : {}),
    ...(d.aiRunIds.length ? { ai_run_ids: d.aiRunIds } : {}),
  };
}

/** Server-side re-validation of whatever the browser sends before it reaches the RPC (defence in depth; the RPC re-checks everything). */
const uuidOrNull = z.string().uuid().nullable();
export const logPayloadSchema = z.object({
  touch: z.object({
    touch_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    person_id: z.string().uuid().optional(),
    account_id: z.string().uuid(),
    contact_id: uuidOrNull,
    touch_type: z.enum(TOUCH_TYPE_VALUES as [string, ...string[]]),
    channel: z.enum(CHANNELS),
    note: z.string().max(1000).optional(),
    follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignment_id: z.string().uuid().optional(),
    success_nominated: z.boolean().optional(),
    capture_method: z.enum(["Web", "Mobile", "Teams bot", "Text to manager (AI-parsed)", "Voice note (AI-parsed)"]),
    raw_capture_text: z.string().max(2000).optional(),
  }),
  actions: z.array(z.object({
    action_code: z.enum(ACTION_CODE_VALUES as [string, ...string[]]).refine((c) => c !== "OG0.1", "OG0.1 is added automatically"),
    service_line_id: z.string().uuid(),
    estimated_value_usd: z.number().min(0).max(1_000_000_000),
    customer_answer: z.string().max(600).nullable().optional(),
  })).max(12),
  follow_through: z.object({
    insights: z.array(z.object({ insight_type: z.enum(INSIGHT_TYPES), text: z.string().min(1).max(500), service_line_ids: z.array(z.string().uuid()).optional(), ai_extracted: z.boolean().optional() })).max(6),
    whitespace: z.array(z.object({ service_line_id: z.string().uuid(), status: z.enum(WHITESPACE_STATUSES), status_source: z.string().optional(), from_action_index: z.number().int().min(0).optional() })).max(6),
    opportunities: z.array(z.object({
      name: z.string().min(1).max(200), service_line_id: z.string().uuid(), expansion_lever: z.enum(EXPANSION_LEVERS).optional(),
      estimated_value_usd: z.number().min(0).max(1_000_000_000).optional(), next_step: z.string().max(300).optional(), from_action_index: z.number().int().min(0),
    })).max(4),
    referrals: z.array(z.object({ referred_name_text: z.string().max(200).optional(), from_action_index: z.number().int().min(0) })).max(4),
    share_reading: z.object({ stated_share_pct: z.number().min(0).max(100), scope: z.string().optional(), where_rest_goes: z.string().max(300).optional(), service_line_id: z.string().uuid().optional(), from_action_index: z.number().int().min(0) }).optional(),
  }),
  inbox_id: z.string().uuid().optional(),
  ai_run_ids: z.array(z.string().uuid()).max(6).optional(),
});
