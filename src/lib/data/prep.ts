import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/types";
import { seesRapport } from "@/lib/roles";
import { getRefData } from "@/lib/data/ref";
import { channelWarnings } from "@/lib/outgrow";
import { doNotOfferHits, playIsUsable } from "@/lib/operator/guardrails";

export interface PrepPlay { play_id: string; title: string; script: string; play_type: string }
export interface PrepData {
  contact: {
    contact_id: string; name: string; first_name: string; job_title: string | null; account_id: string; account_name: string; strength: number | null;
    preferred_channel: string | null; interests: string[]; rapport: string | null; priorities: string | null; days_since_touch: number | null; already_raised: string[];
  };
  showRapport: boolean;
  assignment: { assignment_id: string; instruction: string; why_now: string | null; expected_action_code: string | null } | null;
  play: PrepPlay | null;
  thenPlay: PrepPlay | null;
  insights: { insight_type: string; text: string }[];
  warnings: string[];
  channelRule: string | null;
}

const DEFAULT_RDYK = "rDYK-02";
const PLAY_COLS = "play_id, title, script, play_type, approval_status, to_capability_id";

/** Everything the Prep sheet and the brief job need, read through the caller's own RLS view of the data. Null if the contact isn't visible. */
export async function loadPrep(supabase: SupabaseClient, me: Me, input: { contactId: string; assignmentId?: string | null }): Promise<PrepData | null> {
  const { data: c } = await supabase.from("contacts_safe")
    .select("contact_id, first_name, last_name, preferred_name, job_title, account_id, country, opt_out_channels, contact_status, preferred_channel, relationship_strength, interests, rapport_notes, current_priorities, days_since_proactive_touch, service_lines_dyked")
    .eq("contact_id", input.contactId).maybeSingle();
  if (!c) return null;

  const [acct, asg, ins, dno, ref] = await Promise.all([
    supabase.from("accounts_safe").select("name, country").eq("account_id", c.account_id).maybeSingle(),
    input.assignmentId
      ? supabase.from("assignments").select("assignment_id, instruction, why_now, expected_action_code, suggested_play_id").eq("assignment_id", input.assignmentId).maybeSingle()
      : supabase.from("assignments").select("assignment_id, instruction, why_now, expected_action_code, suggested_play_id").eq("contact_id", input.contactId).eq("assignee_id", me.person_id ?? "").eq("status", "Open").order("week_start", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("insights").select("insight_type, text").or(`contact_id.eq.${input.contactId},account_id.eq.${c.account_id}`).eq("status", "Open").order("captured_at", { ascending: false }).limit(3),
    supabase.from("capabilities").select("capability_id").eq("do_not_offer", true),
    getRefData(),
  ]);
  const blocked = new Set((dno.data ?? []).map((x) => String(x.capability_id)));

  const fetchPlay = async (id: string | null | undefined): Promise<PrepPlay | null> => {
    if (!id) return null;
    const { data } = await supabase.from("plays").select(PLAY_COLS).eq("play_id", id).maybeSingle();
    if (!data || !playIsUsable({ play_id: data.play_id, approval_status: data.approval_status, to_capability_id: data.to_capability_id }, blocked)) return null;
    if (doNotOfferHits(String(data.script ?? ""), ref.doNotOffer).length > 0) return null;
    return { play_id: data.play_id as string, title: data.title as string, script: (data.script as string) ?? "", play_type: data.play_type as string };
  };

  const assigned = await fetchPlay(asg.data?.suggested_play_id as string | undefined);
  const play = assigned ?? (await fetchPlay(DEFAULT_RDYK));
  // A Did You Know is always followed by the Reverse DYK, so the person ends by asking what else the customer is working on.
  const thenPlay = play && play.play_type === "DYK" ? await fetchPlay(DEFAULT_RDYK) : null;

  const showRapport = seesRapport({ app_role: me.app_role, is_admin: me.is_admin });
  const name = `${(c.preferred_name as string | null)?.trim() || c.first_name} ${c.last_name}`.trim();
  const dykedIds = (c.service_lines_dyked as string[] | null) ?? [];
  const lineName = new Map(ref.serviceLines.map((l) => [l.service_line_id, l.name]));
  const country = (c.country as string | null) ?? (acct.data?.country as string | null) ?? null;
  const rule = country ? ref.channelRules.find((r) => r.country_codes?.includes(country)) : undefined;
  const warnings = channelWarnings({
    channel: (c.preferred_channel as string | null) ?? "Call", touchType: "Proactive call", contactName: name, contactCountry: c.country as string | null,
    accountCountry: acct.data?.country as string | null, optOutChannels: c.opt_out_channels as string[] | null, contactStatus: c.contact_status as string | null,
    rules: ref.channelRules, asks: 1,
  }).map((w) => w.message);

  return {
    contact: {
      contact_id: c.contact_id as string, name, first_name: ((c.preferred_name as string | null)?.trim() || (c.first_name as string)), job_title: c.job_title as string | null,
      account_id: c.account_id as string, account_name: (acct.data?.name as string | undefined) ?? "Account", strength: c.relationship_strength as number | null,
      preferred_channel: c.preferred_channel as string | null, interests: showRapport ? ((c.interests as string[] | null) ?? []) : [],
      rapport: showRapport ? (c.rapport_notes as string | null) : null, priorities: c.current_priorities as string | null,
      days_since_touch: c.days_since_proactive_touch as number | null, already_raised: dykedIds.map((id) => lineName.get(id)).filter((x): x is string => !!x),
    },
    showRapport,
    assignment: asg.data ? { assignment_id: asg.data.assignment_id as string, instruction: asg.data.instruction as string, why_now: asg.data.why_now as string | null, expected_action_code: asg.data.expected_action_code as string | null } : null,
    play, thenPlay,
    insights: (ins.data ?? []).map((i) => ({ insight_type: i.insight_type as string, text: i.text as string })),
    warnings,
    channelRule: rule ? `${rule.geography}: prefer ${rule.primary_channel}${rule.avoid ? `; ${rule.avoid}` : ""}` : null,
  };
}
