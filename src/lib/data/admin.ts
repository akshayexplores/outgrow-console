import "server-only";
import { createClient } from "@/lib/supabase/server";
import { employeeStatus, type EmployeeStatus } from "@/lib/admin-schemas";
import type { AppRole } from "@/lib/roles";

export interface EmployeeRow {
  person_id: string; full_name: string; email: string; app_role: AppRole; job_role: string | null; outgrow_role: string | null; manager_id: string | null;
  weekly_target: number; show_on_ranked_scorecard: boolean; logging_mode: string | null; is_participant: boolean; active: boolean;
  invited_at: string | null; last_sign_in_at: string | null; is_example: boolean; status: EmployeeStatus;
}

export async function listEmployees(): Promise<EmployeeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("acsia_people")
    .select("person_id,full_name,email,app_role,job_role,outgrow_role,manager_id,weekly_target,show_on_ranked_scorecard,logging_mode,is_participant,active,invited_at,last_sign_in_at,is_example")
    .is("archived_at", null)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ ...(p as Omit<EmployeeRow, "status">), status: employeeStatus(p as { active: boolean; invited_at: string | null; last_sign_in_at: string | null }) }));
}

export async function getSettings(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
}

export interface AuditRow { audit_id: string; table_name: string; record_id: string; field: string | null; old_value: string | null; new_value: string | null; changed_by_email: string | null; changed_at: string }

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("audit_id,table_name,record_id,field,old_value,new_value,changed_by_email,changed_at")
    .in("table_name", ["acsia_people", "app_settings", "auth_link", "picklists", "ai_routes", "import"])
    .order("changed_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditRow[];
}
