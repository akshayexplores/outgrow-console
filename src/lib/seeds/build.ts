import { uuidv5 } from "./uuid";
import serviceLinesJson from "../../../seed/service_lines.json";
import capabilitiesJson from "../../../seed/capabilities_do_not_offer.json";
import playsJson from "../../../seed/plays.json";
import picklistsJson from "../../../seed/picklists.json";
import actionCodesJson from "../../../seed/action_codes.json";
import listDefinitionsJson from "../../../seed/list_definitions.json";
import channelRulesJson from "../../../seed/channel_rules.json";
import focusCalendarJson from "../../../seed/focus_calendar.json";
import aiRoutesJson from "../../../seed/ai_routes.json";

/**
 * Reference data (library) from the handoff pack, mapped onto the schema. Pure: no I/O.
 * Both the seed CLI (scripts/seed.ts), the admin "Load library seeds" button and the SQL exporter use this one function.
 * Ids are deterministic (uuid v5) so re-running is idempotent.
 */

export type Row = Record<string, string | number | boolean | null | string[]>;

export interface SeedTable { table: string; pk: string; rows: Row[]; /** editable in the app → default mode never overwrites */ editable: boolean; arrayTypes?: Record<string, "text" | "uuid"> }

const PRIORITY_LABEL: Record<number, string> = { 1: "1 - Lead with it", 2: "2 - Offer with proof", 3: "3 - Learn first (rDYK)" };

/** Country code labels for PL_COUNTRY (the picklist file only carries a comment for this list). */
const COUNTRIES: [string, string][] = [
  ["IN", "India"], ["DE", "Germany"], ["US", "United States"], ["JP", "Japan"], ["KR", "South Korea"], ["CN", "China"], ["FR", "France"],
  ["IT", "Italy"], ["SE", "Sweden"], ["GB", "United Kingdom"], ["NL", "Netherlands"], ["CH", "Switzerland"], ["AT", "Austria"], ["CZ", "Czechia"], ["PT", "Portugal"],
];

const GEOGRAPHY_COUNTRIES: Record<string, string[]> = {
  India: ["IN"], US: ["US"], Germany: ["DE"], Japan: ["JP"], "South Korea": ["KR"], "France / Italy / Sweden": ["FR", "IT", "SE"],
};

/** Featured service line for each month's theme (focus_calendar has no theme column; the featured service line carries it). */
const THEME_SERVICE_LINE: Record<string, string> = {
  LiLA: "LILA", "ASPICE + LiLA": "LILA", "V&V depth": "VV", "Functional safety to ASIL B": "FUSA", "Android / Linux platform depth": "EMB", "LiLA again": "LILA",
};

/** Lists live at pilot: the ones marked "Yes" (day one). The rest exist but are switched off until their data exists. L10 (cold) is out of scope by design. */
const isPilotActive = (activate: string) => /^yes/i.test(activate.trim());

interface PlayJson {
  play_id: string; play_type: string; action_code: string; title: string; to_service_line: string; script: string; proof_point_internal?: string;
  trigger?: string; best_fit_accounts_text?: string; confidence_band?: string; priority: number; requires_signoff: boolean; approval_status: string; source?: string;
}

export function buildReferenceSeed(): SeedTable[] {
  const serviceLines = serviceLinesJson as { name: string; short_code: string; confidence_band: string; is_lila: boolean; active: boolean; sort_order: number }[];
  const slId = new Map(serviceLines.map((s) => [s.name, uuidv5(`service_line:${s.short_code}`)]));
  const need = (name: string) => {
    const v = slId.get(name);
    if (!v) throw new Error(`Seed error: unknown service line "${name}"`);
    return v;
  };

  const service_lines: Row[] = serviceLines.map((s) => ({
    service_line_id: need(s.name), name: s.name, short_code: s.short_code, confidence_band: s.confidence_band, is_lila: s.is_lila, active: s.active, sort_order: s.sort_order,
  }));

  const capabilities: Row[] = (capabilitiesJson as { name: string; service_line: string; in_portfolio: boolean; do_not_offer: boolean; honest_boundary: string }[]).map((c) => ({
    capability_id: uuidv5(`capability:${c.name}`), service_line_id: need(c.service_line), name: c.name, in_portfolio: c.in_portfolio, do_not_offer: c.do_not_offer, honest_boundary: c.honest_boundary,
  }));

  const plays = playsJson as PlayJson[];
  const proof_points: Row[] = plays.filter((p) => p.proof_point_internal).map((p) => ({
    proof_id: uuidv5(`proof:${p.play_id}`),
    title: `Proof for ${p.play_id}`,
    internal_statement: p.proof_point_internal!,
    service_line_ids: [need(p.to_service_line)],
    // Internal statements may name customers: internal use only until Pre-sales approves an external version.
    approval_status: "Approved - internal",
  }));
  const playsRows: Row[] = plays.map((p) => ({
    play_id: p.play_id, play_type: p.play_type, action_code: p.action_code, title: p.title, script: p.script,
    to_service_line_id: need(p.to_service_line), trigger: p.trigger ?? null, geography_notes: null,
    proof_point_id: p.proof_point_internal ? uuidv5(`proof:${p.play_id}`) : null,
    priority: PRIORITY_LABEL[p.priority] ?? PRIORITY_LABEL[2]!, confidence_band: p.confidence_band ?? null,
    requires_signoff: p.requires_signoff, approval_status: p.approval_status,
  }));

  const picklists: Row[] = [];
  const actionCodes = actionCodesJson as { code: string; label: string; rule: string }[];
  actionCodes.forEach((a, i) => picklists.push({ id: uuidv5("picklist:PL_ACTION_CODE:" + a.code), picklist_name: "PL_ACTION_CODE", value: a.code, label: a.label, description: a.rule || null, sort_order: i, active: true }));
  for (const [name, values] of Object.entries(picklistsJson as Record<string, string[]>)) {
    if (name === "PL_ACTION_CODE") continue;
    if (name === "PL_COUNTRY") {
      COUNTRIES.forEach(([code, label], i) => picklists.push({ id: uuidv5(`picklist:${name}:${code}`), picklist_name: name, value: code, label, description: null, sort_order: i, active: true }));
      continue;
    }
    values.filter((v) => !v.startsWith("(")).forEach((v, i) =>
      picklists.push({ id: uuidv5(`picklist:${name}:${v}`), picklist_name: name, value: v, label: v, description: null, sort_order: i, active: true }));
  }

  const playIds = new Set(plays.map((p) => p.play_id));
  const list_definitions: Row[] = (listDefinitionsJson as { id: string; name: string; book_category: number | string; entity: string; rule: string; default_script: string; activate_at_pilot: string }[])
    .filter((l) => l.id !== "L10" && ["Account", "Contact", "Opportunity"].includes(l.entity))
    .map((l) => {
      const m = /^(r?DYK-\d+)/i.exec(l.default_script.trim());
      const playId = m && playIds.has(m[1]!) ? m[1]! : null;
      const cat = typeof l.book_category === "number" ? l.book_category : Number.parseInt(String(l.book_category), 10);
      return { list_id: l.id, name: l.name, book_category: Number.isFinite(cat) ? cat : null, entity: l.entity, rule: l.rule, default_play_id: playId, active: isPilotActive(l.activate_at_pilot) };
    });

  const channel_rules: Row[] = (channelRulesJson as { geography: string; primary_channel: string; follow_up_channel: string; avoid: string; blocked_channels: string[] }[]).map((r) => ({
    rule_id: uuidv5(`channel_rule:${r.geography}`), geography: r.geography, primary_channel: r.primary_channel, follow_up_channel: r.follow_up_channel,
    avoid: r.avoid || null, blocked_channels: r.blocked_channels, country_codes: GEOGRAPHY_COUNTRIES[r.geography] ?? [],
  }));

  const slByCode = new Map(serviceLines.map((s) => [s.short_code, need(s.name)]));
  const focus_calendar: Row[] = (focusCalendarJson as { period_type: string; period_start: string; period_end: string; dyk_focus_play_ids: string[]; theme: string; referral_focus: string; prompt_card_questions: string[] }[]).map((f) => ({
    focus_id: uuidv5(`focus:${f.period_type}:${f.period_start}`), period_type: f.period_type, period_start: f.period_start, period_end: f.period_end,
    dyk_focus_play_ids: f.dyk_focus_play_ids, referral_focus: f.referral_focus, prompt_card_questions: f.prompt_card_questions,
    featured_service_line_id: slByCode.get(THEME_SERVICE_LINE[f.theme] ?? "") ?? null,
  }));

  const ai_routes: Row[] = (aiRoutesJson as { routes: { job: string; primary_model: string; fallback_model: string; temperature: number; max_tokens: number; human_role: string; enabled: boolean }[] }).routes.map((r) => ({ ...r }));

  // FK order: parents first.
  return [
    { table: "service_lines", pk: "service_line_id", rows: service_lines, editable: true },
    { table: "capabilities", pk: "capability_id", rows: capabilities, editable: true },
    { table: "proof_points", pk: "proof_id", rows: proof_points, editable: true, arrayTypes: { service_line_ids: "uuid" } },
    { table: "plays", pk: "play_id", rows: playsRows, editable: true },
    { table: "picklists", pk: "id", rows: picklists, editable: true },
    { table: "list_definitions", pk: "list_id", rows: list_definitions, editable: true },
    { table: "channel_rules", pk: "rule_id", rows: channel_rules, editable: true, arrayTypes: { blocked_channels: "text", country_codes: "text" } },
    { table: "focus_calendar", pk: "focus_id", rows: focus_calendar, editable: true, arrayTypes: { dyk_focus_play_ids: "text", prompt_card_questions: "text" } },
    { table: "ai_routes", pk: "job", rows: ai_routes, editable: true },
  ];
}
