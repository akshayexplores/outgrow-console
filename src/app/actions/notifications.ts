"use server";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { errResult, friendlyDbError, okResult, type ActionResult } from "@/lib/types";

/** Marks the caller's own unread notifications as read (RLS and a column grant limit this to read_at on their own rows). */
export async function markNotificationsRead(): Promise<ActionResult> {
  const s = await requireActionSession();
  if (!s.me.person_id) return okResult(undefined);
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("person_id", s.me.person_id).is("read_at", null);
  if (error) return errResult(friendlyDbError(error.message));
  return okResult(undefined);
}
