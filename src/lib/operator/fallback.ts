/**
 * The plain-form parser: what the Log flow uses when the AI operator is switched off, has no key, is rate-limited or fails.
 * It reads the note with keyword rules and produces the same "raw" shapes the model would, so the same normalisers clamp both.
 * It is deliberately conservative: it proposes only what the words clearly say, and the person confirms everything on the Check screen.
 */
import { addDays, weekStartOf } from "@/lib/dates";
import type { CaptureRaw, FollowRaw, ServiceLineLite } from "@/lib/operator/normalize";

const SERVICE_KEYWORDS: Record<string, RegExp> = {
  LILA: /\b(lila|agentic|ai platform)\b/i,
  FUSA: /\b(functional safety|fusa|26262|asil|hara|safety case)\b/i,
  CYB: /\b(cyber ?security|cybersecurity|21434|tara|pen ?test|penetration)\b/i,
  ADAS: /\b(adas|autonomous driving|lane keep|emergency braking|ad stack)\b/i,
  AUT: /\b(autosar|bsw|rte|adaptive platform|classic platform)\b/i,
  EMB: /\b(qnx|linux|bsp|android automotive|embedded|hypervisor|middleware)\b/i,
  EV: /\b(e-?mobility|battery|bms|charging|charger|ev platform|electric vehicle|\bEV\b)\b/i,
  TEL: /\b(telematics|tcu|connectivity|avb|tsn|v2x|ota|ethernet)\b/i,
  IVI: /\b(cockpit|ivi|infotainment|instrument cluster|hmi|display)\b/i,
  VV: /\b(v&v|v and v|validation|verification|hil|sil|test cases?|testers?|testing|regression|test automation)\b/i,
  ASP: /\b(aspice|spice|process assessment)\b/i,
  SYS: /\b(requirements?|system engineering|architecture|systems? design)\b/i,
  PM: /\b(programme management|program management|project management)\b/i,
  CLD: /\b(cloud|backend|data platform|data pipeline)\b/i,
  BODY: /\b(body control|bcm|comfort|door|seat|wiper)\b/i,
};

/** The service line a sentence is about: the keyword that matches first in the text. Returns a short_code or "NONE". */
export function guessServiceCode(text: string): string {
  let best: { code: string; at: number } | null = null;
  for (const [code, re] of Object.entries(SERVICE_KEYWORDS)) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.at)) best = { code, at: m.index };
  }
  return best?.code ?? "NONE";
}

/** "$60k", "60k", "$1.2m", "1.5 lakh" → whole USD. Bare numbers ("2 people") are not amounts. */
export function guessValueUsd(text: string): number {
  const m = /(?:\$\s?(\d+(?:[.,]\d+)?)\s?(k|m|lakhs?|cr)?|\b(\d+(?:\.\d+)?)\s?(k|m)\b)/i.exec(text);
  if (!m) return 0;
  const n = Number((m[1] ?? m[3] ?? "0").replace(/,/g, ""));
  const unit = (m[2] ?? m[4] ?? "").toLowerCase();
  const mult = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : unit.startsWith("lakh") ? 100_000 : unit === "cr" ? 10_000_000 : 1;
  const v = Math.round(n * mult);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** A follow-up date from words like "tomorrow", "next week", "on Tuesday", "in 2 weeks", "12 Oct" or an ISO date. Null when there isn't one. */
export function guessFollowUp(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso && iso[1]! > today) return iso[1]!;
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  const inN = /\bin (\d{1,2}) (day|week)s?\b/.exec(t);
  if (inN) return addDays(today, Number(inN[1]) * (inN[2] === "week" ? 7 : 1));
  if (/\bnext week\b/.test(t)) return addDays(weekStartOf(today), 7);
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s(${MONTHS.join("|")})[a-z]*\\b`).exec(t);
  if (dm) {
    const y = Number(today.slice(0, 4));
    const month = MONTHS.indexOf(dm[2]!) + 1;
    let cand = `${y}-${String(month).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`;
    if (cand <= today) cand = `${y + 1}-${cand.slice(5)}`;
    if (!Number.isNaN(Date.parse(cand))) return cand;
  }
  const wd = new RegExp(`\\b(?:on |next |this )?(${WEEKDAYS.join("|")})\\b`).exec(t);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]!);
    const now = new Date(today + "T00:00:00Z").getUTCDay();
    const delta = ((target - now + 7) % 7) || 7;
    return addDays(today, delta);
  }
  return null;
}

export function guessTouch(text: string): { touchType: string; channel: string } {
  const t = text.toLowerCase();
  if (/\bvoicemail|left a message\b/.test(t)) return { touchType: "Voicemail + text", channel: "Voicemail + text" };
  if (/\b(handwritten|hand-written|thank-?you note)\b/.test(t)) return { touchType: "Handwritten note", channel: "Handwritten note" };
  if (/\b(they|he|she) (called|rang|phoned) (me|us)\b|\binbound\b|\bcalled me\b/.test(t)) return { touchType: "Inbound (customer-initiated)", channel: "Call" };
  if (/\b(after|when)\b[^.]{0,25}\bemail/.test(t)) return { touchType: "Call-when-emailed", channel: "Call" };
  if (/\b(visited|visit|dropped by|on[- ]site|walked over|at (their|his|her) (office|site|desk))\b/.test(t)) return { touchType: "Unscheduled visit (on site)", channel: "In person" };
  if (/\b(scheduled|sync|review|workshop|steering|standing)\b|\bmeeting\b/.test(t)) {
    return { touchType: "Scheduled meeting", channel: /\b(video|teams|zoom|meet)\b/.test(t) ? "Video call" : /\bin person|on site\b/.test(t) ? "In person" : "Video call" };
  }
  const channel = /\bwhatsapp\b/.test(t) ? "WhatsApp" : /\bkakao/.test(t) ? "KakaoTalk" : /\bsms|text message\b/.test(t) ? "SMS" : /\bteams\b/.test(t) ? "Teams" : "Call";
  return { touchType: "Proactive call", channel };
}

/** The one candidate contact whose name (or first name) appears in the note, if exactly one does. */
export function guessContactId(text: string, candidates: { id: string; name: string }[]): string | null {
  const t = text.toLowerCase();
  const hits = candidates.filter((c) => {
    const parts = c.name.toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
    return t.includes(c.name.toLowerCase()) || (parts[0] !== undefined && new RegExp(`\\b${parts[0].replace(/[^a-z0-9]/g, "")}\\b`).test(t));
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

const RDYK = /\b(other (vendors?|suppliers?|partners?)|another (vendor|supplier|partner)|elsewhere|what else|short on|slipping|struggling|stretched|need(?:s|ed)? (?:more |two |2 |a few )?(?:people|engineers|testers|help|resources)|outsourc\w*|goes? to|competitor|in-?house)\b/i;
const DYK = /\b(did you know|mentioned (?:that )?we|told (?:him|her|them) (?:that )?we|brought up|pitched|suggested|we also (?:do|offer|have)|introduced (?:him|her|them) to)\b/i;
const NEXT = /\b(next (?:week|month|call|meeting)|catch up|walk-?through|book(?:ed)?|follow[- ]?up (?:call|meeting)|see (?:him|her|them)|calendar|schedule(?:d)? (?:a|the|another)|demo)\b|\b(?:on |next )(?:monday|tuesday|wednesday|thursday|friday)\b/i;
const PROPOSAL = /\b(proposal|quote|quotation|rfq|sow)\b/i;
const PREPROP = /\b(ready for a proposal|send (?:a )?proposal|scope we discussed|shall i draft)\b/i;
const SCOPE = /\b(shall we scope|scope (?:that|it)|go ahead|kick-?off|start (?:in|from|next))\b/i;
const SHARE = /(\d{1,3})\s?(?:%|percent)|\bshare of (?:their|the) (?:work|spend|business)\b|\bhow much of\b/i;
const REFERRAL = /\b(introduc\w*|other (?:teams?|programmes?|programs?|groups?)|who else|who runs|refer\w*)\b/i;

interface Ask { code: string; service_line: string; value_usd: number; said: string }

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Keyword capture. Same output shape as the model's capture job (CaptureRaw), so normaliseCapture handles both. */
export function heuristicCapture(text: string, ctx: { today: string; candidates: { id: string; name: string }[]; preselectedContactId: string | null }): CaptureRaw {
  const sents = sentences(text);
  const topic = guessServiceCode(text);
  const asks: Ask[] = [];
  const has = (code: string) => asks.some((a) => a.code === code);
  const add = (code: string, sentence: string, own?: string) => {
    if (has(code)) return;
    asks.push({ code, service_line: own ?? (guessServiceCode(sentence) !== "NONE" ? guessServiceCode(sentence) : topic), value_usd: 0, said: sentence.slice(0, 200) });
  };
  for (const s of sents) {
    if (DYK.test(s)) add("OG1.1", s);
    if (RDYK.test(s)) add("OG1.2", s);
    if (SHARE.test(s)) add("OG3.1", s, "NONE");
    if (REFERRAL.test(s)) add("OG4.1", s, "NONE");
    if (PREPROP.test(s)) add("OG2.4", s);
    else if (PROPOSAL.test(s)) add("OG2.3", s);
    if (SCOPE.test(s)) add("OG2.1", s);
    if (NEXT.test(s)) add("OG2.2", s, has("OG1.1") || has("OG1.2") ? asks.find((a) => a.code === "OG1.1" || a.code === "OG1.2")!.service_line : "NONE");
  }
  const amount = guessValueUsd(text);
  const target = asks.find((a) => a.code === "OG1.2") ?? asks.find((a) => a.code === "OG1.1") ?? asks[0];
  if (amount > 0 && target) target.value_usd = amount;
  // The customer said something, but no rule matched: keep one relationship-only ask so the person isn't left with an empty list.
  if (asks.length === 0 && text.trim()) asks.push({ code: "OG1.2", service_line: topic, value_usd: amount, said: text.trim().slice(0, 200) });
  const { touchType, channel } = guessTouch(text);
  return {
    contact_id: ctx.preselectedContactId ?? guessContactId(text, ctx.candidates),
    touch_type: touchType,
    channel,
    actions: asks.map((a) => ({ code: a.code, service_line: a.service_line, value_usd: a.value_usd, said: a.said })),
    follow_up_date: guessFollowUp(text, ctx.today),
    note_one_line: sents[0]?.slice(0, 240) ?? "",
  };
}

/** Keyword follow-through suggestions from the asks the person confirmed. Same shape as the follow job (FollowRaw). */
export function heuristicFollow(asks: { index: number; code: string; service_line: string; value_usd: number; said: string }[], lines: ServiceLineLite[]): FollowRaw {
  const name = (code: string) => lines.find((l) => l.short_code === code)?.name ?? code;
  const out: FollowRaw["suggestions"] = [];
  for (const a of asks) {
    if (out.length >= 4) break;
    if (a.code === "OG1.2" && a.said) {
      const others = /\b(other|another|elsewhere|competitor|outsourc)/i.test(a.said);
      out.push({ kind: "insight", text: `Note what they said: "${a.said.slice(0, 120)}"`, payload: { insight_type: others ? "Gives to other vendor" : "Pain point", text: a.said.slice(0, 300), service_line: a.service_line } });
      if (a.service_line !== "NONE" && others) out.push({ kind: "whitespace", text: `${name(a.service_line)} is held by someone else`, payload: { service_line: a.service_line, status: "Held by competitor", from_action_index: a.index } });
      else if (a.service_line !== "NONE") out.push({ kind: "whitespace", text: `${name(a.service_line)}: a need is likely`, payload: { service_line: a.service_line, status: "Need likely", from_action_index: a.index } });
      if (a.service_line !== "NONE" && a.value_usd > 0) out.push({ kind: "opportunity", text: `Log an opportunity: ${name(a.service_line)}`, payload: { name: `${name(a.service_line)} expansion`, service_line: a.service_line, expansion_lever: "New service line (cross-sell)", estimated_value_usd: a.value_usd, from_action_index: a.index } });
    } else if (a.code === "OG1.1" && a.service_line !== "NONE" && a.value_usd > 0) {
      out.push({ kind: "opportunity", text: `Log an opportunity: ${name(a.service_line)}`, payload: { name: `${name(a.service_line)} cross-sell`, service_line: a.service_line, expansion_lever: "New service line (cross-sell)", estimated_value_usd: a.value_usd, from_action_index: a.index } });
    } else if (a.code === "OG4.1") {
      out.push({ kind: "referral", text: "They named another team or person to talk to", payload: { referred_name_text: "", from_action_index: a.index } });
    } else if (a.code === "OG3.1") {
      const m = SHARE.exec(a.said);
      const pct = m?.[1] ? Number(m[1]) : NaN;
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100) out.push({ kind: "share_reading", text: `They said about ${pct}% of the work is with Acsia`, payload: { stated_share_pct: pct, from_action_index: a.index } });
    }
  }
  return { suggestions: out.slice(0, 4) };
}
