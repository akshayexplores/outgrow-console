"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
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
