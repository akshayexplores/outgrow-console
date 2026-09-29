import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIST, weekStartOf } from "@/lib/dates";
import { isParticipating, participationThreshold } from "@/lib/outgrow";
import { nameMaps, type InboxRow } from "@/lib/data/today";

export interface PlanRow {
  assignment_id: string; status: string; assignee_id: string; assignee_name: string; contact_id: string | null; contact_name: string; account_name: string;
  why: string; instruction: string; why_now: string | null; expected_action_code: string | null; suggested_play_id: string | null; due_date: string | null;
}
export interface RosterRow { person_id: string; full_name: string; job_role: string | null; actions: number; target: number; threshold: number; participated: boolean; streak: number }
export interface TeamData { weekStart: string; plan: PlanRow[]; roster: RosterRow[]; inbox: InboxRow[]; assignmentsDone: number; assignmentsTotal: number }

export async function loadTeam(supabase: SupabaseClient): Promise<TeamData> {
  const weekStart = weekStartOf(todayIST());
  const [statRes, asgRes, inboxRes] = await Promise.all([
    supabase.rpc("week_stats", { p_week: weekStart }),
    supabase.from("assignments").select("assignment_id, status, assignee_id, contact_id, account_id, list_id, instruction, why_now, coverage_note, expected_action_code, suggested_play_id, due_date")
      .eq("week_start", weekStart).neq("status", "Dropped").order("created_at", { ascending: true }).limit(300),
    supabase.from("capture_inbox").select("id, from_person_id, text, status, created_at").eq("status", "new").order("created_at", { ascending: false }).limit(50),
  ]);
  const stats = (statRes.data ?? []) as { person_id: string; full_name: string; job_role: string | null; actions: number; weekly_target: number; participated: boolean; streak_weeks: number }[];
  const asg = (asgRes.data ?? []) as { assignment_id: string; status: string; assignee_id: string; contact_id: string | null; account_id: string | null; list_id: string | null; instruction: string; why_now: string | null; coverage_note: string | null; expected_action_code: string | null; suggested_play_id: string | null; due_date: string | null }[];
  const inbox = (inboxRes.data ?? []) as { id: string; from_person_id: string; text: string; status: string; created_at: string }[];

  const listIds = [...new Set(asg.map((a) => a.list_id).filter((x): x is string => !!x))];
  const personIds = [...new Set([...asg.map((a) => a.assignee_id), ...inbox.map((i) => i.from_person_id)])];
  const [names, lists, people] = await Promise.all([
    nameMaps(supabase, asg.map((a) => a.contact_id).filter((x): x is string => !!x), asg.map((a) => a.account_id).filter((x): x is string => !!x)),
    listIds.length ? supabase.from("list_definitions").select("list_id, name").in("list_id", listIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    personIds.length ? supabase.from("acsia_people").select("person_id, full_name").in("person_id", personIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const listName = new Map((lists.data ?? []).map((l) => [l.list_id as string, l.name as string]));
  const pName = new Map((people.data ?? []).map((p) => [p.person_id as string, p.full_name as string]));

  const plan: PlanRow[] = asg.map((a) => {
    const c = a.contact_id ? names.contacts.get(a.contact_id) : undefined;
    return {
      assignment_id: a.assignment_id, status: a.status, assignee_id: a.assignee_id, assignee_name: pName.get(a.assignee_id) ?? "Colleague", contact_id: a.contact_id,
      contact_name: c?.name ?? "Contact", account_name: names.accounts.get(a.account_id ?? c?.account_id ?? "") ?? "", why: a.why_now ?? (a.list_id ? listName.get(a.list_id) : undefined) ?? a.coverage_note ?? "",
      instruction: a.instruction, why_now: a.why_now, expected_action_code: a.expected_action_code, suggested_play_id: a.suggested_play_id, due_date: a.due_date,
    };
  });
  const roster: RosterRow[] = stats.map((s) => ({
    person_id: s.person_id, full_name: s.full_name, job_role: s.job_role, actions: s.actions, target: s.weekly_target, threshold: participationThreshold(s.weekly_target),
    participated: isParticipating(s.actions, s.weekly_target), streak: s.streak_weeks,
  }));
  const active = plan.filter((p) => p.status !== "Draft");
  return {
    weekStart, plan, roster,
    inbox: inbox.map((i) => ({ ...i, from_name: pName.get(i.from_person_id) ?? "Colleague" })),
    assignmentsDone: active.filter((p) => p.status === "Done").length, assignmentsTotal: active.length,
  };
}
