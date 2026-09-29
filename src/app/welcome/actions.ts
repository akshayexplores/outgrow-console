"use server";
import { redirect } from "next/navigation";
import { requireActionSession, landingFor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** Marks the 3-step welcome as seen (finished or skipped) and sends the person to their home screen. */
export async function finishWelcome(): Promise<void> {
  const { me } = await requireActionSession();
  const supabase = await createClient();
  await supabase.rpc("mark_welcomed");
  redirect(landingFor(me));
}
