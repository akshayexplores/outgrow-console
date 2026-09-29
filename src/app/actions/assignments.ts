"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ACTION_CODE_VALUES } from "@/lib/outgrow";
import { errResult, friendlyDbError, isoDate, okResult, uuid, type ActionResult } from "@/lib/types";

const refresh = () => { for (const p of ["/team", "/today"]) revalidatePath(p); };

const ids = z.array(uuid).min(1).max(100);

export async function approveAssignments(raw: unknown): Promise<ActionResult<{ count: number }>> {
  await requireActionSession();
  const p = ids.safeParse(raw);
  if (!p.success) return errResult("Choose at least one assignment.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_assignments", { p_ids: p.data, p_approve: true });
  if (error) return errResult(friendlyDbError(error.message));
  refresh();
  return okResult({ count: Number(data ?? 0) });
}

export async function dropAssignments(raw: unknown): Promise<ActionResult<{ count: number }>> {
  await requireActionSession();
  const p = ids.safeParse(raw);
  if (!p.success) return errResult("Choose at least one assignment.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_assignments", { p_ids: p.data, p_approve: false });
  if (error) return errResult(friendlyDbError(error.message));
  refresh();
  return okResult({ count: Number(data ?? 0) });
}

const fields = {
  instruction: z.string().trim().min(3, "Write a one-sentence instruction.").max(500, "Keep the instruction under 500 characters."),
  why_now: z.string().trim().max(60, "Keep 'why now' under 60 characters.").optional().or(z.literal("")),
  expected_action_code: z.enum(ACTION_CODE_VALUES as [string, ...string[]]).optional().or(z.literal("")),
  suggested_play_id: z.string().trim().max(40).optional().or(z.literal("")),
  due_date: isoDate.optional().or(z.literal("")),
};

const createSchema = z.object({ assignee_id: uuid, contact_id: uuid, ...fields });
export async function createAssignment(raw: unknown): Promise<ActionResult<{ id: string }>> {
  await requireActionSession();
  const p = createSchema.safeParse(raw);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Check the form.");
  const supabase = await createClient();
  // Created by a manager or leader, so it goes straight to Open (the assignee is notified); the planner's drafts are the ones that wait for approval.
  const { data, error } = await supabase.rpc("create_assignment", { p: { ...p.data, status: "Open" } });
  if (error) return errResult(friendlyDbError(error.message));
  refresh();
  return okResult({ id: String(data) });
}

const updateSchema = z.object({ id: uuid, ...fields, assignee_id: uuid.optional() });
export async function updateAssignment(raw: unknown): Promise<ActionResult> {
  await requireActionSession();
  const p = updateSchema.safeParse(raw);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Check the form.");
  const { id, ...rest } = p.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_assignment", { p_id: id, p: rest });
  if (error) return errResult(friendlyDbError(error.message));
  refresh();
  return okResult(undefined);
}

const skipSchema = z.object({ id: uuid, reason: z.string().trim().min(3, "Say briefly why it was skipped.").max(300) });
export async function skipAssignment(raw: unknown): Promise<ActionResult> {
  await requireActionSession();
  const p = skipSchema.safeParse(raw);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Say briefly why it was skipped.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_assignment_status", { p_id: p.data.id, p_status: "Skipped", p_reason: p.data.reason });
  if (error) return errResult(friendlyDbError(error.message));
  refresh();
  return okResult(undefined);
}

export interface AssignOptions { people: { person_id: string; full_name: string; job_role: string | null }[]; plays: { play_id: string; title: string }[] }

/** Who the caller may assign to (their team, or everyone for a leader) and the approved plays to attach. The RPC re-checks both. */
export async function loadAssignOptions(): Promise<ActionResult<AssignOptions>> {
  const s = await requireActionSession();
  const supabase = await createClient();
  let q = supabase.from("acsia_people").select("person_id, full_name, job_role").eq("active", true).eq("is_participant", true).is("archived_at", null).order("full_name").limit(200);
  const leader = s.me.is_admin || s.me.app_role === "leader";
  if (!leader && s.me.person_id) q = q.or(`manager_id.eq.${s.me.person_id},person_id.eq.${s.me.person_id}`);
  const [people, plays] = await Promise.all([
    q,
    supabase.from("plays").select("play_id, title").like("approval_status", "Approved%").in("action_code", ["OG1.1", "OG1.2", "OG2.1", "OG2.2", "OG4.1"]).order("priority").order("play_id").limit(120),
  ]);
  return okResult({
    people: (people.data ?? []).map((p) => ({ person_id: p.person_id as string, full_name: p.full_name as string, job_role: p.job_role as string | null })),
    plays: (plays.data ?? []).map((p) => ({ play_id: p.play_id as string, title: String(p.title).slice(0, 90) })),
  });
}
