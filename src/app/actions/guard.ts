"use server";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { doNotOfferAdvice } from "@/lib/operator/guardrails";
import { GUARD_KINDS, guardPrompt, type GuardKind } from "@/lib/operator/prompts";
import { runJob } from "@/lib/operator/run";
import { errResult, okResult, type ActionResult } from "@/lib/types";

const schema = z.object({ kind: z.enum(GUARD_KINDS), term: z.string().trim().max(60).default("") });
const out = z.object({ explanation: z.string().min(5).max(500) });

/** The rules themselves are code (log.ts / guardrails.ts). This only asks the model to put a rule that already fired into friendlier words. */
const CANNED: Record<GuardKind, (t: string) => string> = {
  do_not_offer: (t) => doNotOfferAdvice(t || "That"),
  one_dyk: () => "Outgrow keeps to one Did You Know per conversation so the customer hears one clear idea. Keep the one you actually raised.",
  opt_out: () => "This contact asked not to be reached this way. Use a channel they are happy with.",
  country_avoid: () => "This channel is on the avoid list for that country. Pick another way to reach them.",
  do_not_contact: () => "This contact is marked Do not contact, so they can't be called or assigned.",
};

export async function explainGuard(raw: unknown): Promise<ActionResult<{ text: string; ai: boolean }>> {
  const s = await requireActionSession();
  const p = schema.safeParse(raw);
  if (!p.success) return errResult("That warning can't be explained.");
  const r = await runJob("guard", guardPrompt(p.data.kind, p.data.term), { ctx: { personId: s.me.person_id, inputRef: { kind: p.data.kind } }, schema: out });
  if (!r.ok) return okResult({ text: CANNED[p.data.kind](p.data.term), ai: false });
  return okResult({ text: r.data.explanation.replace(/\s+/g, " ").trim(), ai: true });
}
