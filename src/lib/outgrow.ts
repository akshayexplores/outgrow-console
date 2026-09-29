/**
 * The Outgrow rules as plain data + pure functions (docs/02). Mirrors the CHECK constraints in the migrations;
 * tests/unit/outgrow.test.ts compares these lists with the SQL so they cannot drift apart.
 */

export interface ActionCodeDef { code: string; label: string; rule: string; selectable: boolean }
export const ACTION_CODES: ActionCodeDef[] = [
  { code: "OG0.1", label: "Proactive call / visit", rule: "Added automatically for proactive calls and visits. Max one per conversation.", selectable: false },
  { code: "OG1.1", label: "Did You Know", rule: "Mention ONE service they don't buy. It must be something they can pay for.", selectable: true },
  { code: "OG1.2", label: "Reverse Did You Know", rule: "The customer names the opportunity. Highest value.", selectable: true },
  { code: "OG2.1", label: "Pivot to sale", rule: "\"Shall we scope that this week?\"", selectable: true },
  { code: "OG2.2", label: "Pivot to next conversation", rule: "\"Can I see you in March?\" The main action on long cycles.", selectable: true },
  { code: "OG2.3", label: "Proposal follow-up", rule: "Anything past the 4–8 week window.", selectable: true },
  { code: "OG2.4", label: "Pre-proposal follow-up", rule: "\"Ready for a proposal on the scope we discussed?\"", selectable: true },
  { code: "OG3.1", label: "Percentage of business", rule: "Two parts: the share, then \"where does the rest go?\"", selectable: true },
  { code: "OG4.1", label: "Internal referral request", rule: "\"Which other programmes have the same problem?\" Never a yes/no question.", selectable: true },
  { code: "OG4.2", label: "External referral request", rule: "New logo: handed to the AE, not worked in Outgrow.", selectable: true },
  { code: "OG5.1", label: "Testimonial shared", rule: "Uses a signed-off testimonial.", selectable: true },
  { code: "OG6.1", label: "Handwritten note", rule: "Personal only.", selectable: true },
];
export const SELECTABLE_ACTION_CODES = ACTION_CODES.filter((a) => a.selectable);
export const ACTION_CODE_VALUES = ACTION_CODES.map((a) => a.code);
export const actionLabel = (code: string) => ACTION_CODES.find((a) => a.code === code)?.label ?? code;

export interface TouchTypeDef { value: string; label: string; proactive: boolean; addsOg01: boolean }
export const TOUCH_TYPES: TouchTypeDef[] = [
  { value: "Proactive call", label: "Proactive call", proactive: true, addsOg01: true },
  { value: "Voicemail + text", label: "Voicemail + text", proactive: true, addsOg01: true },
  { value: "Unscheduled visit (on site)", label: "Unscheduled visit (on site)", proactive: true, addsOg01: true },
  { value: "Handwritten note", label: "Handwritten note", proactive: true, addsOg01: false },
  { value: "Scheduled meeting", label: "Scheduled meeting", proactive: false, addsOg01: false },
  { value: "Inbound (customer-initiated)", label: "Inbound (customer called)", proactive: false, addsOg01: false },
  { value: "Call-when-emailed", label: "Call-when-emailed", proactive: false, addsOg01: false },
];
export const TOUCH_TYPE_VALUES = TOUCH_TYPES.map((t) => t.value);
/** Email is never an action channel (PRD principle 6). It is deliberately absent from this list. */
export const CHANNELS = ["Call", "Voicemail + text", "In person", "Teams", "WhatsApp", "KakaoTalk", "Video call", "SMS", "Handwritten note"] as const;
export type Channel = (typeof CHANNELS)[number];
export const isProactive = (type: string) => TOUCH_TYPES.find((t) => t.value === type)?.proactive ?? false;
export const addsOg01 = (type: string) => TOUCH_TYPES.find((t) => t.value === type)?.addsOg01 ?? false;

/** How many actions a saved log will write: each ask, plus OG0.1 for a proactive call/visit. */
export function actionCount(touchType: string, asks: number): number {
  return asks + (addsOg01(touchType) ? 1 : 0);
}

/** Participating = at least least(5, weekly_target) actions in the week, and a target above zero (docs/02). */
export function participationThreshold(weeklyTarget: number): number {
  return Math.min(5, Math.max(0, weeklyTarget));
}
export function isParticipating(actions: number, weeklyTarget: number): boolean {
  return weeklyTarget > 0 && actions >= participationThreshold(weeklyTarget);
}

export const VALUE_STAGES = ["Opportunity", "Proposal", "Closed"] as const;
export const EXPANSION_LEVERS = ["New service line (cross-sell)", "More volume (same scope)", "New buyer (internal referral)", "New site / geography", "Engagement model change", "Renewal / extension", "Win-back"] as const;
export const OPP_STAGES = ["Identified", "Qualifying", "Pre-proposal", "Proposal sent", "Negotiation", "Won", "Lost", "Parked"] as const;
export const WHITESPACE_STATUSES = ["Buying from Acsia", "Held by competitor", "In-house", "Need confirmed - unsourced", "Need likely", "Not relevant", "Unknown", "Acsia can't offer"] as const;
export const INSIGHT_TYPES = ["Interest", "Pain point", "Priority / initiative", "Talking point", "Rapport", "Account news / signal", "Sourcing timing", "Budget", "Objection", "Didn't know you did that", "Gives to other vendor", "Rate comparison"] as const;
export const CUSTOMER_RESPONSES = ["Positive", "Neutral", "Not now", "No answer", "Negative"] as const;

export interface ChannelWarning { code: "OPT_OUT" | "COUNTRY_AVOID" | "DO_NOT_CONTACT" | "NOT_PROACTIVE"; message: string }

export interface ChannelRuleLite { geography: string; avoid: string | null; blocked_channels: string[] | null; country_codes: string[] | null }

/** Warnings shown on the Check screen. They warn, they never block (the database records the same warnings). */
export function channelWarnings(args: {
  channel: string;
  touchType: string;
  contactName?: string;
  contactCountry?: string | null;
  accountCountry?: string | null;
  optOutChannels?: string[] | null;
  contactStatus?: string | null;
  rules: ChannelRuleLite[];
  asks: number;
}): ChannelWarning[] {
  const out: ChannelWarning[] = [];
  const who = args.contactName ?? "This contact";
  if (args.contactStatus === "Do not contact") out.push({ code: "DO_NOT_CONTACT", message: `${who} is marked Do not contact.` });
  if (args.optOutChannels?.includes(args.channel)) out.push({ code: "OPT_OUT", message: `${who} has opted out of ${args.channel}.` });
  const country = args.contactCountry ?? args.accountCountry ?? null;
  if (country) {
    for (const r of args.rules) {
      if (r.country_codes?.includes(country) && r.blocked_channels?.includes(args.channel)) {
        out.push({ code: "COUNTRY_AVOID", message: `${r.geography}: ${r.avoid?.trim() || `${args.channel} is on the avoid list`}.` });
      }
    }
  }
  if (!isProactive(args.touchType) && args.asks === 0) {
    out.push({ code: "NOT_PROACTIVE", message: "A scheduled or inbound conversation only counts through the asks inside it." });
  }
  return out;
}

/** Channels the assignment/planner may suggest for a contact: not opted out, not blocked in their country. */
export function allowedChannels(args: { optOutChannels?: string[] | null; country?: string | null; rules: ChannelRuleLite[] }): Channel[] {
  const blocked = new Set<string>(args.optOutChannels ?? []);
  if (args.country) for (const r of args.rules) if (r.country_codes?.includes(args.country)) (r.blocked_channels ?? []).forEach((c) => blocked.add(c));
  return CHANNELS.filter((c) => !blocked.has(c));
}
