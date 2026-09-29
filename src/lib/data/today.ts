import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/types";
import { addDays, todayIST, weekStartOf } from "@/lib/dates";
import { isParticipating, participationThreshold } from "@/lib/outgrow";

export interface WeekStat { actions: number; target: number; threshold: number; participated: boolean; streak: number }
export interface AssignmentCard {
  assignment_id: string; status: string; contact_id: string | null; contact_name: string; account_id: string | null; account_name: string;
  why: string; play_id: string | null; instruction: string; expected_action_code: string | null;
}
export interface LoggedRow { touch_id: string; contact_name: string; summary: string; n: number }
export interface InboxRow { id: string; from_person_id: string; from_name: string; text: string; status: string; created_at: string }
export interface TodayData {
  today: string; weekStart: string; stat: WeekStat | null; assignments: AssignmentCard[]; logged: LoggedRow[];
  inbox: InboxRow[]; myNotes: InboxRow[]; focusQuestion: string; focusMonth: string | null; approverName: string | null;
}

const VISIBLE = ["Open", "Done", "Partly done", "Rolled over", "Skipped"];

export async function nameMaps(supabase: SupabaseClient, contactIds: string[], accountIds: string[]) {
  const cIds = [...new Set(contactIds)].filter(Boolean);
  const c = cIds.length
    ? await supabase.from("contacts_safe").select("contact_id, first_name, last_name, preferred_name, account_id").in("contact_id", cIds)
    : { data: [] as Record<string, unknown>[] };
  const contacts = new Map<string, { name: string; account_id: string }>();
  for (const r of c.data ?? []) contacts.set(r.contact_id as string, { name: `${(r.preferred_name as string | null)?.trim() || r.first_name} ${r.last_name}`.trim(), account_id: r.account_id as string });
  const aIds = [...new Set([...accountIds, ...[...contacts.values()].map((x) => x.account_id)])].filter(Boolean);
  const a = aIds.length ? await supabase.from("accounts_safe").select("account_id, name").in("account_id", aIds) : { data: [] as Record<string, unknown>[] };
  const accounts = new Map((a.data ?? []).map((r) => [r.account_id as string, r.name as string]));
  return { contacts, accounts };
}

export async function loadToday(supabase: SupabaseClient, me: Me): Promise<TodayData> {
  const today = todayIST();
  const weekStart = weekStartOf(today);
  const personId = me.person_id;
  const empty: TodayData = { today, weekStart, stat: null, assignments: [], logged: [], inbox: [], myNotes: [], focusQuestion: "What else are you working on that we might be able to help with?", focusMonth: null, approverName: null };
  if (!personId) return empty;

  const [statRes, asgRes, touchRes, inboxRes, notesRes, focusRes] = await Promise.all([
    supabase.rpc("week_stats", { p_week: weekStart }),
    supabase.from("assignments").select("assignment_id, status, contact_id, account_id, list_id, expected_action_code, suggested_play_id, instruction, why_now, coverage_note, assigned_by_id")
      .eq("assignee_id", personId).eq("week_start", weekStart).in("status", VISIBLE).order("created_at", { ascending: true }).limit(60),
    supabase.from("touches").select("touch_id, contact_id, touch_date").eq("person_id", personId).gte("touch_date", weekStart).lte("touch_date", addDays(weekStart, 6)).is("archived_at", null).order("created_at", { ascending: false }).limit(30),
    me.app_role === "delivery_lead"
      ? supabase.from("capture_inbox").select("id, from_person_id, text, status, created_at").eq("to_manager_id", personId).eq("status", "new").order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    me.app_role === "engineer"
      ? supabase.from("capture_inbox").select("id, from_person_id, text, status, created_at").eq("from_person_id", personId).gte("created_at", `${today.slice(0, 7)}-01T00:00:00+05:30`).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from("focus_calendar").select("period_start, prompt_card_questions").eq("period_type", "Month").lte("period_start", today).gte("period_end", today).is("archived_at", null).limit(1).maybeSingle(),
  ]);

  const s = ((statRes.data ?? []) as { person_id: string; actions: number; weekly_target: number; participated: boolean; streak_weeks: number }[]).find((r) => r.person_id === personId);
  const stat: WeekStat | null = s
    ? { actions: s.actions, target: s.weekly_target, threshold: participationThreshold(s.weekly_target), participated: isParticipating(s.actions, s.weekly_target), streak: s.streak_weeks }
    : null;

  const asg = (asgRes.data ?? []) as { assignment_id: string; status: string; contact_id: string | null; account_id: string | null; list_id: string | null; expected_action_code: string | null; suggested_play_id: string | null; instruction: string; why_now: string | null; coverage_note: string | null; assigned_by_id: string | null }[];
  const touches = (touchRes.data ?? []) as { touch_id: string; contact_id: string | null }[];
  const listIds = [...new Set(asg.map((a) => a.list_id).filter((x): x is string => !!x))];
  const touchIds = touches.map((t) => t.touch_id);
  const inbox = ((inboxRes.data ?? []) as { id: string; from_person_id: string; text: string; status: string; created_at: string }[]);
  const notes = ((notesRes.data ?? []) as { id: string; from_person_id: string; text: string; status: string; created_at: string }[]);

  const [names, lists, acts, people] = await Promise.all([
    nameMaps(supabase, [...asg.map((a) => a.contact_id), ...touches.map((t) => t.contact_id)].filter((x): x is string => !!x), asg.map((a) => a.account_id).filter((x): x is string => !!x)),
    listIds.length ? supabase.from("list_definitions").select("list_id, name").in("list_id", listIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    touchIds.length ? supabase.from("actions_safe").select("touch_id, action_code").in("touch_id", touchIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    (() => {
      const ids = [...new Set([...inbox.map((i) => i.from_person_id), ...asg.map((a) => a.assigned_by_id).filter((x): x is string => !!x)])];
      return ids.length ? supabase.from("acsia_people").select("person_id, full_name").in("person_id", ids) : Promise.resolve({ data: [] as Record<string, unknown>[] });
    })(),
  ]);
  const listName = new Map((lists.data ?? []).map((l) => [l.list_id as string, l.name as string]));
  const personName = new Map((people.data ?? []).map((p) => [p.person_id as string, p.full_name as string]));
  const codesByTouch = new Map<string, string[]>();
  for (const a of acts.data ?? []) {
    const k = a.touch_id as string;
    codesByTouch.set(k, [...(codesByTouch.get(k) ?? []), a.action_code as string]);
  }

  const assignments: AssignmentCard[] = asg.map((a) => {
    const c = a.contact_id ? names.contacts.get(a.contact_id) : undefined;
    return {
      assignment_id: a.assignment_id, status: a.status, contact_id: a.contact_id, contact_name: c?.name ?? "Contact", account_id: a.account_id ?? c?.account_id ?? null,
      account_name: names.accounts.get(a.account_id ?? c?.account_id ?? "") ?? "", why: a.why_now ?? (a.list_id ? listName.get(a.list_id) : undefined) ?? a.coverage_note ?? "",
      play_id: a.suggested_play_id, instruction: a.instruction, expected_action_code: a.expected_action_code,
    };
  });
  const logged: LoggedRow[] = touches.map((t) => {
    const codes = (codesByTouch.get(t.touch_id) ?? []).sort();
    return { touch_id: t.touch_id, contact_name: (t.contact_id ? names.contacts.get(t.contact_id)?.name : undefined) ?? "Conversation", summary: codes.join(" · "), n: codes.length };
  });
  const focusQs = (focusRes.data?.prompt_card_questions as string[] | null | undefined) ?? [];
  const approver = asg.find((a) => a.assigned_by_id && a.assigned_by_id !== personId)?.assigned_by_id ?? null;

  return {
    today, weekStart, stat, assignments, logged,
    inbox: inbox.map((i) => ({ ...i, from_name: personName.get(i.from_person_id) ?? "Colleague" })),
    myNotes: notes.map((i) => ({ ...i, from_name: me.full_name })),
    focusQuestion: focusQs[0] ?? empty.focusQuestion,
    focusMonth: focusRes.data?.period_start ? String(focusRes.data.period_start) : null,
    approverName: approver ? (personName.get(approver) ?? null) : null,
  };
}
