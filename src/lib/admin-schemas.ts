import { z } from "zod";
import { appRoleSchema, DEFAULT_JOB_ROLE, DEFAULT_OUTGROW_ROLE, DEFAULT_TARGET, JOB_ROLES, LOGGING_MODES, OUTGROW_ROLES, type AppRole } from "@/lib/roles";

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const employeeInputSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the person's full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  app_role: appRoleSchema,
  job_role: z.preprocess(emptyToUndef, z.enum(JOB_ROLES).optional()),
  outgrow_role: z.preprocess(emptyToUndef, z.enum(OUTGROW_ROLES).optional()),
  manager_id: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  weekly_target: z.coerce.number().int("Use a whole number.").min(0).max(100),
  show_on_ranked_scorecard: z.coerce.boolean(),
  logging_mode: z.preprocess(emptyToUndef, z.enum(LOGGING_MODES).optional()),
});
export type EmployeeInput = z.infer<typeof employeeInputSchema>;

export function defaultsForRole(role: AppRole) {
  return {
    weekly_target: DEFAULT_TARGET[role],
    job_role: DEFAULT_JOB_ROLE[role],
    outgrow_role: DEFAULT_OUTGROW_ROLE[role],
    // Engineers stay off the ranked scorecard by default (they are counted, not ranked) and text their manager.
    show_on_ranked_scorecard: role !== "engineer",
    logging_mode: role === "engineer" ? ("Manager proxy" as const) : ("Self" as const),
  };
}

export const settingsSchema = z.object({
  allowed_email_domain: z.string().trim().toLowerCase().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$|^$/, "Use a domain like acsiatech.com, or leave empty."),
  scorecard_publish_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time like 14:00."),
  programme_start: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use a date like 2026-10-05, or leave empty."),
});

export type EmployeeStatus = "Deactivated" | "Active" | "Invited" | "Not invited";
export function employeeStatus(p: { active: boolean; invited_at: string | null; last_sign_in_at: string | null }): EmployeeStatus {
  if (!p.active) return "Deactivated";
  if (p.last_sign_in_at) return "Active";
  return p.invited_at ? "Invited" : "Not invited";
}

/** CSV columns for the bulk employee import (docs/03 flow 3). */
export const EMPLOYEE_CSV_COLUMNS = ["full_name", "email", "app_role", "job_role", "manager_email", "weekly_target", "show_on_ranked_scorecard", "logging_mode"] as const;
