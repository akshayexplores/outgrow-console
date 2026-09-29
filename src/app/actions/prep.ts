"use server";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadPrep, type PrepData } from "@/lib/data/prep";
import { errResult, okResult, uuid, type ActionResult } from "@/lib/types";

const input = z.object({ contactId: uuid, assignmentId: uuid.nullable().optional() });

export async function getPrep(raw: unknown): Promise<ActionResult<PrepData>> {
  const s = await requireActionSession();
  const p = input.safeParse(raw);
  if (!p.success) return errResult("That contact isn't valid.");
  const supabase = await createClient();
  const data = await loadPrep(supabase, s.me, p.data);
  if (!data) return errResult("You don't have access to that contact, or it no longer exists.");
  return okResult(data);
}
