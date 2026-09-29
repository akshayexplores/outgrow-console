"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRefData } from "@/lib/data/ref";
import { contactsByIds, searchContactsLite, suggestedContactIds } from "@/lib/data/contacts";
import { addDays, todayIST, weekStartOf } from "@/lib/dates";
import { canLog } from "@/lib/roles";
import { errResult, friendlyDbError, okResult, uuid, type ActionResult } from "@/lib/types";
import { logPayloadSchema, type ContactLite, type FollowSuggestion, type LogAsk } from "@/lib/log";
import { capturePrompt, followPrompt } from "@/lib/operator/prompts";
import { runJob } from "@/lib/operator/run";
import { captureRawSchema, followRawSchema, normaliseCapture, normaliseFollow, type ServiceLineLite } from "@/lib/operator/normalize";
import { heuristicCapture, heuristicFollow, guessContactId } from "@/lib/operator/fallback";

/* ------------------------------------------------------------------ contact lookup for the Log sheet */

export interface ContactChoices { suggested: ContactLite[] }

export async function loadContactChoices(input: { contactId?: string | null; personId?: string | null }): Promise<ActionResult<ContactChoices>> {
  const s = await requireActionSession();
  const supabase = await createClient();
  const who = input.personId ?? s.me.person_id;
  const today = todayIST();
  const ids = who ? await suggestedContactIds(supabase, who, weekStartOf(today), addDays(today, -30)) : [];
  if (input.contactId) ids.unshift(input.contactId);
  return okResult({ suggested: await contactsByIds(supabase, ids) });
}

export async function searchContacts(query: string): Promise<ActionResult<ContactLite[]>> {
  await requireActionSession();
  const supabase = await createClient();
  return okResult(await searchContactsLite(supabase, String(query ?? "")));
}

export async function loadPerson(personId: string): Promise<ActionResult<{ person_id: string; full_name: string } | null>> {
  const parsed = uuid.safeParse(personId);
  if (!parsed.success) return okResult(null);
  await requireActionSession();
  const supabase = await createClient();
  const { data } = await supabase.from("acsia_people").select("person_id, full_name").eq("person_id", parsed.data).maybeSingle();
  return okResult(data ? { person_id: data.person_id as string, full_name: data.full_name as string } : null);
}

/* ------------------------------------------------------------------ text → draft */

const parseInput = z.object({
  text: z.string().trim().min(3, "Write a sentence or two about what happened first.").max(2000, "That's long. Keep it under 2,000 characters."),
  contactId: uuid.nullable().optional(),
  personId: uuid.nullable().optional(),
});

export interface ParsedDraft {
  contact: ContactLite | null;
  touchType: string;
  channel: string;
  followUpDate: string;
  note: string;
  asks: Omit<LogAsk, "key">[];
  follow: FollowSuggestion[];
  aiRunIds: string[];
  usedAi: boolean;
  /** Set when the plain-form parser answered instead of the model (with the reason, in words). */
  notice: string | null;
}

/** Capitalised words in the note are probably names; look them up so the model can pick the right contact. */
function nameTokens(text: string): string[] {
  const stop = new Set(["The", "And", "But", "They", "She", "He", "Mentioned", "Called", "Spoke", "Talked", "Said", "Asked", "Next", "Also", "Then", "This", "That", "With", "From", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Acsia", "LiLA", "AUTOSAR", "ASPICE"]);
  const found = text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  return [...new Set(found.filter((w) => !stop.has(w)))].slice(0, 3);
}

export async function parseCapture(raw: unknown): Promise<ActionResult<ParsedDraft>> {
  const s = await requireActionSession();
  if (!canLog({ app_role: s.me.app_role, is_admin: s.me.is_admin })) return errResult("Your role doesn't log conversations.");
  const parsed = parseInput.safeParse(raw);
  if (!parsed.success) return errResult(parsed.error.issues[0]?.message ?? "Check what you wrote.");
  const { text, contactId, personId } = parsed.data;

  const supabase = await createClient();
  const today = todayIST();
  const who = personId ?? s.me.person_id;
  const ref = await getRefData();
  const lines: ServiceLineLite[] = ref.serviceLines.map((l) => ({ service_line_id: l.service_line_id, name: l.name, short_code: l.short_code }));

  // Candidates the model may choose from: the contact already picked, this person's likely contacts, and anyone named in the note.
  const ids: string[] = [];
  if (contactId) ids.push(contactId);
  if (who) ids.push(...(await suggestedContactIds(supabase, who, weekStartOf(today), addDays(today, -30))));
  const found = await Promise.all(nameTokens(text).map((t) => searchContactsLite(supabase, t)));
  const candidates = await contactsByIds(supabase, [...ids, ...found.flat().map((c) => c.contact_id)].slice(0, 40));
  const cand = candidates.map((c) => ({ id: c.contact_id, name: c.name, account: c.account_name }));

  const ctx = { lines, candidateContactIds: new Set(candidates.map((c) => c.contact_id)), preselectedContactId: contactId ?? null, today };
  const aiRunIds: string[] = [];
  let usedAi = false;
  let notice: string | null = null;
  let log: ReturnType<typeof normaliseCapture>;

  const cap = await runJob("capture", capturePrompt({
    note: text, today, personName: s.me.full_name, preselectedContactId: contactId ?? null, candidates: cand,
    serviceLines: ref.serviceLines.map((l) => ({ short_code: l.short_code, name: l.name })),
  }), { ctx: { personId: s.me.person_id, inputRef: { chars: text.length, candidates: cand.length } }, schema: captureRawSchema });

  if (cap.ok) {
    usedAi = true;
    if (cap.runId) aiRunIds.push(cap.runId);
    log = normaliseCapture(cap.data, ctx);
  } else {
    notice = cap.message;
    log = normaliseCapture(heuristicCapture(text, { today, candidates: cand, preselectedContactId: contactId ?? null }), ctx);
  }
  if (!log.contact_id) log.contact_id = guessContactId(text, cand);
  const contact = candidates.find((c) => c.contact_id === log.contact_id) ?? null;

  // Follow-through: only from the confirmed asks; the model suggests, the person ticks.
  const short = (id: string) => lines.find((l) => l.service_line_id === id)?.short_code ?? "NONE";
  const asksForFollow = log.asks.map((a, index) => ({ index, code: a.code, service_line: short(a.service_line_id), value_usd: Number(a.value_usd) || 0, said: a.said }));
  let follow: FollowSuggestion[] = [];
  if (asksForFollow.length > 0) {
    let raw2 = null as ReturnType<typeof followRawSchema.parse> | null;
    if (usedAi) {
      const fr = await runJob("follow", followPrompt({
        contactName: contact?.name ?? "", accountName: contact?.account_name ?? "", asks: asksForFollow, note: text,
        serviceLines: ref.serviceLines.map((l) => ({ short_code: l.short_code, name: l.name })), hasContact: !!contact,
      }), { ctx: { personId: s.me.person_id, inputRef: { asks: asksForFollow.length } }, schema: followRawSchema });
      if (fr.ok) { raw2 = fr.data; if (fr.runId) aiRunIds.push(fr.runId); }
      else notice = "The operator read your note, but couldn't suggest follow-through. Tick what applies below.";
    }
    if (!raw2) raw2 = heuristicFollow(asksForFollow, lines);
    follow = normaliseFollow(raw2, { asks: log.asks, lines, hasContact: !!contact });
  }

  return okResult({
    contact, touchType: log.touch_type, channel: String(log.channel), followUpDate: log.follow_up_date ?? "", note: log.note,
    asks: log.asks, follow, aiRunIds, usedAi, notice,
  });
}

/* ------------------------------------------------------------------ save */

export interface SaveResult {
  touchId: string;
  actionsWritten: number;
  created: { insights: number; whitespace: number; opportunities: number; referrals: number; share_readings: number; stories: number };
  warnings: string[];
  week: { actions: number; target: number; threshold: number; participating: boolean; just_reached: boolean };
}

const resultSchema = z.object({
  touch_id: z.string(),
  actions_written: z.number(),
  created: z.object({
    insights: z.number().default(0), whitespace: z.number().default(0), opportunities: z.number().default(0),
    referrals: z.number().default(0), share_readings: z.number().default(0), stories: z.number().default(0),
  }),
  warnings: z.array(z.unknown()).nullable().default([]),
  week: z.object({ actions: z.number(), target: z.number(), threshold: z.number(), participating: z.boolean(), just_reached: z.boolean() }),
});

/** Re-validates the payload on the server, then hands it to the single-transaction RPC. Everything is saved or nothing is. */
export async function saveLog(raw: unknown): Promise<ActionResult<SaveResult>> {
  await requireActionSession();
  const parsed = logPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return errResult(`Check the form: ${i ? `${i.path.join(" › ")} ${i.message}` : "something is missing"}.`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("log_conversation", { p: parsed.data });
  if (error) return errResult(friendlyDbError(error.message));
  const r = resultSchema.safeParse(data);
  if (!r.success) return errResult("Saved, but the confirmation was unreadable. Refresh to see it.");
  for (const path of ["/today", "/accounts", "/team", "/scorecard"]) revalidatePath(path);
  const warnings = (r.data.warnings ?? []).map((w) => (typeof w === "string" ? w : typeof w === "object" && w && "message" in w ? String((w as { message: unknown }).message) : "")).filter(Boolean);
  return okResult({ touchId: r.data.touch_id, actionsWritten: r.data.actions_written, created: r.data.created, warnings, week: r.data.week });
}

/* ------------------------------------------------------------------ engineers → manager inbox */

export async function submitCapture(text: string): Promise<ActionResult<{ id: string }>> {
  await requireActionSession();
  const t = String(text ?? "").trim();
  if (t.length < 5) return errResult("Write a line about what the customer mentioned.");
  if (t.length > 2000) return errResult("That's long. Keep it under 2,000 characters.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_capture", { p_text: t, p_channel: "web" });
  if (error) return errResult(friendlyDbError(error.message));
  revalidatePath("/today");
  return okResult({ id: String(data) });
}

export async function dismissCapture(id: string): Promise<ActionResult> {
  await requireActionSession();
  const p = uuid.safeParse(id);
  if (!p.success) return errResult("That note isn't valid.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_capture", { p_id: p.data });
  if (error) return errResult(friendlyDbError(error.message));
  revalidatePath("/today");
  revalidatePath("/team");
  return okResult(undefined);
}
