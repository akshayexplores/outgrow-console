import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession, landingFor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayIST, monthName } from "@/lib/dates";
import { canLog } from "@/lib/roles";
import { firstName } from "@/lib/format";
import { WelcomeClient } from "./welcome-client";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const { me } = await requireSession();
  if (me.welcomed_at || !me.on_roster) redirect(landingFor(me));
  const supabase = await createClient();
  const today = todayIST();
  const { data } = await supabase
    .from("focus_calendar")
    .select("prompt_card_questions,theme:referral_focus")
    .eq("period_type", "Month").lte("period_start", today).gte("period_end", today).is("archived_at", null).limit(1).maybeSingle();
  const questions = ((data?.prompt_card_questions as string[] | null) ?? []).filter(Boolean);
  return (
    <WelcomeClient
      name={firstName(me.full_name)}
      month={monthName(today)}
      questions={questions.length ? questions : ["What else are you working on that we might be able to help with?"]}
      logs={canLog({ app_role: me.app_role, is_admin: me.is_admin })}
    />
  );
}
