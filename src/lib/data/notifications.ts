import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NavKey } from "@/lib/roles";
import type { Me } from "@/lib/types";
import { todayIST, weekStartOf } from "@/lib/dates";

export interface NotificationItem { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read: boolean }

export async function loadNotifications(supabase: SupabaseClient, me: Me): Promise<NotificationItem[]> {
  if (!me.person_id) return [];
  const { data } = await supabase.from("notifications").select("id, kind, title, body, link, created_at, read_at").eq("person_id", me.person_id).order("created_at", { ascending: false }).limit(15);
  return (data ?? []).map((n) => ({ id: n.id as string, kind: n.kind as string, title: n.title as string, body: n.body as string | null, link: n.link as string | null, created_at: n.created_at as string, read: !!n.read_at }));
}

/** Small counts on the nav: notes waiting and drafts to approve (Team), approvals waiting (Library). Head-only counts, so they cost almost nothing. */
export async function loadBadges(supabase: SupabaseClient, me: Me): Promise<Partial<Record<NavKey, number>>> {
  const out: Partial<Record<NavKey, number>> = {};
  const manager = me.app_role === "delivery_lead" || me.app_role === "leader" || me.is_admin;
  const leader = me.app_role === "leader" || me.is_admin;
  const week = weekStartOf(todayIST());
  const [inbox, drafts, plays] = await Promise.all([
    manager ? supabase.from("capture_inbox").select("id", { count: "exact", head: true }).eq("status", "new") : Promise.resolve({ count: 0 }),
    manager ? supabase.from("assignments").select("assignment_id", { count: "exact", head: true }).eq("status", "Draft").eq("week_start", week) : Promise.resolve({ count: 0 }),
    leader ? supabase.from("plays").select("play_id", { count: "exact", head: true }).eq("approval_status", "Draft") : Promise.resolve({ count: 0 }),
  ]);
  const team = (inbox.count ?? 0) + (drafts.count ?? 0);
  if (team > 0) out.team = team;
  if ((plays.count ?? 0) > 0) out.library = plays.count ?? 0;
  return out;
}
