"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayIST, weekStartOf } from "@/lib/dates";
import { draftScorecard } from "@/lib/operator/score";
import { errResult, friendlyDbError, isoDate, okResult, uuid, type ActionResult } from "@/lib/types";

const base = z.object({ week: isoDate, text: z.string().trim().max(1500, "Keep the commentary under 1,500 characters.") });

export async function saveCommentary(raw: unknown): Promise<ActionResult> {
  await requireActionSession();
  const p = base.safeParse(raw);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Check the commentary.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_scorecard_commentary", { p_week: p.data.week, p_commentary: p.data.text });
  if (error) return errResult(friendlyDbError(error.message));
  revalidatePath("/scorecard");
  return okResult(undefined);
}

export async function publishScorecard(raw: unknown): Promise<ActionResult<{ notified: number }>> {
  await requireActionSession();
  const p = base.extend({ storyId: uuid.nullable().optional() }).safeParse(raw);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Check the commentary.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_scorecard", { p_week: p.data.week, p_commentary: p.data.text, p_story: p.data.storyId ?? null });
  if (error) return errResult(friendlyDbError(error.message));
  revalidatePath("/scorecard");
  revalidatePath("/today");
  return okResult({ notified: Number((data as { notified?: number } | null)?.notified ?? 0) });
}

const draftBase = z.object({ week: isoDate });

/** "Draft it for me": the operator writes a commentary draft next to the week. It is only ever a draft; the leader chooses whether to use it. */
export async function draftCommentary(raw: unknown): Promise<ActionResult<{ message: string | null }>> {
  const s = await requireActionSession();
  if (!(s.me.is_admin || s.me.app_role === "leader" || s.me.app_role === "ceo")) return errResult("Only the Outgrow leader or CEO can draft the commentary.");
  const p = draftBase.safeParse(raw);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Check the week.");
  const thisWeek = weekStartOf(todayIST());
  if (p.data.week !== thisWeek && p.data.week !== addDays(thisWeek, -7)) return errResult("The operator only drafts for this week or last week.");
  try {
    const r = await draftScorecard({ weekStart: p.data.week, personId: s.me.person_id });
    revalidatePath("/scorecard");
    if (r.status !== "drafted") return errResult(r.message);
    return okResult({ message: r.draft.note });
  } catch {
    return errResult("The draft couldn't be written just now. Try again in a minute.");
  }
}

/** Records that the leader took the operator's draft (the Operator screen shows how often drafts are used). */
export async function acceptDraft(raw: unknown): Promise<ActionResult> {
  await requireActionSession();
  const p = z.object({ runId: uuid }).safeParse(raw);
  if (!p.success) return errResult("That draft isn't valid.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_ai_run_accepted", { p_run: p.data.runId, p_accepted: true });
  if (error) return errResult(friendlyDbError(error.message));
  return okResult(undefined);
}
