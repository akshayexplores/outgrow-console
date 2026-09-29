"use server";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, publicEnv } from "@/lib/env";
import { defaultsForRole, employeeInputSchema, settingsSchema, EMPLOYEE_CSV_COLUMNS, type EmployeeInput } from "@/lib/admin-schemas";
import { appRoleSchema } from "@/lib/roles";
import { errResult, friendlyDbError, okResult, type ActionResult } from "@/lib/types";
import { applyReferenceSeed, type SeedMode, type SeedReport } from "@/lib/seeds/apply";

export interface InviteOutcome { sent: boolean; message: string }

const MAILER_HINT = "On Supabase's Free plan the built-in mailer only reaches project team members. Use “Copy sign-in link” instead, or set up custom SMTP (see README).";

async function auditNote(table: string, recordId: string, field: string, value: string, byEmail: string | null) {
  await createAdminClient().from("audit_log").insert({ table_name: table, record_id: recordId, field, new_value: value, changed_by_email: byEmail });
}

/** Sends the invite (new user) or a fresh magic link (existing user). Never throws: the outcome says what happened. */
async function inviteOrMagicLink(person: { person_id: string; email: string }): Promise<InviteOutcome> {
  const admin = createAdminClient();
  const redirectTo = `${appUrl()}/auth/callback`;
  const { data: row } = await admin.from("acsia_people").select("auth_user_id").eq("person_id", person.person_id).maybeSingle();
  if (!row?.auth_user_id) {
    const { error } = await admin.auth.admin.inviteUserByEmail(person.email, { redirectTo });
    if (!error) return { sent: true, message: `Invitation sent to ${person.email}.` };
    if (!/already (been )?registered|already exists/i.test(error.message)) return { sent: false, message: `The invitation email couldn't be sent (${error.message}). ${MAILER_HINT}` };
  }
  const anon = createSupabaseClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anon.auth.signInWithOtp({ email: person.email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
  if (error) return { sent: false, message: `The sign-in email couldn't be sent (${error.message}). ${MAILER_HINT}` };
  return { sent: true, message: `Sign-in link emailed to ${person.email}.` };
}

async function markInvited(personId: string) {
  const supabase = await createClient();
  await supabase.from("acsia_people").update({ invited_at: new Date().toISOString() }).eq("person_id", personId);
}

function toRow(e: EmployeeInput) {
  const d = defaultsForRole(e.app_role);
  return {
    full_name: e.full_name, email: e.email, app_role: e.app_role,
    job_role: e.job_role ?? d.job_role, outgrow_role: e.outgrow_role ?? d.outgrow_role, manager_id: e.manager_id ?? null,
    weekly_target: e.weekly_target, is_participant: e.weekly_target > 0, show_on_ranked_scorecard: e.show_on_ranked_scorecard,
    logging_mode: e.logging_mode ?? d.logging_mode, active: true,
  };
}

export async function addEmployee(input: unknown, sendInvite: boolean): Promise<ActionResult<{ personId: string; invite?: InviteOutcome }>> {
  await requireAdmin();
  const parsed = employeeInputSchema.safeParse(input);
  if (!parsed.success) return errResult(parsed.error.issues[0]?.message ?? "Check the form.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("acsia_people").insert(toRow(parsed.data)).select("person_id,email").single();
  if (error) return errResult(/duplicate key|unique/i.test(error.message) ? "That email is already on the roster." : friendlyDbError(error.message));
  let invite: InviteOutcome | undefined;
  if (sendInvite) {
    invite = await inviteOrMagicLink(data);
    if (invite.sent) await markInvited(data.person_id);
  }
  revalidatePath("/admin");
  return okResult({ personId: data.person_id, invite });
}

export async function updateEmployee(personId: string, input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(personId);
  const parsed = employeeInputSchema.safeParse(input);
  if (!id.success || !parsed.success) return errResult(parsed.success ? "Unknown person." : (parsed.error.issues[0]?.message ?? "Check the form."));
  if (parsed.data.manager_id === id.data) return errResult("A person can't be their own manager.");
  const supabase = await createClient();
  const { email: _email, ...row } = toRow(parsed.data); // email is the sign-in identity: changing it would orphan the auth user
  const { error } = await supabase.from("acsia_people").update(row).eq("person_id", id.data);
  if (error) return errResult(friendlyDbError(error.message));
  revalidatePath("/admin");
  return okResult(undefined);
}

export async function setEmployeeActive(personId: string, active: boolean): Promise<ActionResult> {
  const { me } = await requireAdmin();
  const id = z.string().uuid().safeParse(personId);
  if (!id.success) return errResult("Unknown person.");
  if (!active && me.person_id === id.data) return errResult("You can't deactivate your own profile.");
  const supabase = await createClient();
  const { error } = await supabase.from("acsia_people").update({ active }).eq("person_id", id.data);
  if (error) return errResult(friendlyDbError(error.message));
  // Ban (or unban) the auth user so refresh tokens stop working; RLS already denies a deactivated person immediately.
  const admin = createAdminClient();
  const { data: row } = await admin.from("acsia_people").select("auth_user_id").eq("person_id", id.data).maybeSingle();
  if (row?.auth_user_id) await admin.auth.admin.updateUserById(row.auth_user_id, { ban_duration: active ? "none" : "876000h" });
  revalidatePath("/admin");
  return okResult(undefined);
}

export async function resendInvite(personId: string): Promise<ActionResult<InviteOutcome>> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(personId);
  if (!id.success) return errResult("Unknown person.");
  const supabase = await createClient();
  const { data } = await supabase.from("acsia_people").select("person_id,email,active").eq("person_id", id.data).maybeSingle();
  if (!data) return errResult("Unknown person.");
  if (!data.active) return errResult("Reactivate this person before inviting them.");
  const outcome = await inviteOrMagicLink({ person_id: data.person_id, email: data.email });
  if (outcome.sent) await markInvited(data.person_id);
  revalidatePath("/admin");
  return okResult(outcome);
}

/** One-time sign-in link the admin can hand over (chat, phone). Logs in as that person: admin-only and audited. */
export async function makeSignInLink(personId: string): Promise<ActionResult<{ url: string }>> {
  const { me } = await requireAdmin();
  const id = z.string().uuid().safeParse(personId);
  if (!id.success) return errResult("Unknown person.");
  const supabase = await createClient();
  const { data: person } = await supabase.from("acsia_people").select("person_id,email,active").eq("person_id", id.data).maybeSingle();
  if (!person) return errResult("Unknown person.");
  if (!person.active) return errResult("Reactivate this person first.");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: person.email, options: { redirectTo: `${appUrl()}/auth/callback` } });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) return errResult(`Couldn't create a sign-in link${error ? `: ${error.message}` : "."}`);
  await auditNote("auth_link", person.person_id, "signin_link_generated", person.email, me.email);
  await markInvited(person.person_id);
  return okResult({ url: `${appUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=magiclink` });
}

/* ------------------------------------------------------------------ bulk CSV import */

const csvRowSchema = z.object({
  full_name: z.string().trim(), email: z.string().trim().toLowerCase(), app_role: z.string().trim().toLowerCase(),
  job_role: z.string().trim().optional().default(""), manager_email: z.string().trim().toLowerCase().optional().default(""),
  weekly_target: z.string().trim().optional().default(""), show_on_ranked_scorecard: z.string().trim().optional().default(""), logging_mode: z.string().trim().optional().default(""),
});

export interface CsvRowCheck { line: number; email: string; full_name: string; app_role: string; ok: boolean; errors: string[] }

function checkRows(rows: unknown[], existing: Map<string, string>): { checks: CsvRowCheck[]; valid: { input: EmployeeInput; managerEmail: string }[] } {
  const checks: CsvRowCheck[] = [];
  const valid: { input: EmployeeInput; managerEmail: string }[] = [];
  const seen = new Set<string>();
  const inFile = new Set(rows.map((r) => String((r as Record<string, unknown>)?.email ?? "").trim().toLowerCase()));
  rows.forEach((raw, i) => {
    const errors: string[] = [];
    const r = csvRowSchema.safeParse(raw);
    const line = i + 2; // header is line 1
    if (!r.success) { checks.push({ line, email: "", full_name: "", app_role: "", ok: false, errors: ["Row is not readable."] }); return; }
    const c = r.data;
    const role = appRoleSchema.safeParse(c.app_role);
    if (!role.success) errors.push(`app_role must be one of engineer, pm, delivery_lead, ae, sdr, presales, marketing, leader, ceo (got “${c.app_role}”).`);
    if (seen.has(c.email)) errors.push("Duplicate email in this file.");
    seen.add(c.email);
    if (existing.has(c.email)) errors.push("Already on the roster.");
    if (c.manager_email && !existing.has(c.manager_email) && !inFile.has(c.manager_email)) errors.push(`Manager ${c.manager_email} isn't on the roster or in this file.`);
    const d = role.success ? defaultsForRole(role.data) : null;
    const candidate = {
      full_name: c.full_name, email: c.email, app_role: c.app_role, job_role: c.job_role || undefined,
      weekly_target: c.weekly_target === "" ? (d?.weekly_target ?? 0) : c.weekly_target,
      show_on_ranked_scorecard: c.show_on_ranked_scorecard === "" ? (d?.show_on_ranked_scorecard ?? true) : /^(1|true|yes|y)$/i.test(c.show_on_ranked_scorecard),
      logging_mode: c.logging_mode || undefined,
    };
    const parsed = employeeInputSchema.safeParse(candidate);
    if (!parsed.success) parsed.error.issues.forEach((iss) => errors.push(`${iss.path.join(".") || "row"}: ${iss.message}`));
    checks.push({ line, email: c.email, full_name: c.full_name, app_role: c.app_role, ok: errors.length === 0, errors });
    if (errors.length === 0 && parsed.success) valid.push({ input: parsed.data, managerEmail: c.manager_email });
  });
  return { checks, valid };
}

async function existingEmails(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("acsia_people").select("person_id,email");
  return new Map((data ?? []).map((p) => [String(p.email).toLowerCase(), String(p.person_id)]));
}

export async function validateEmployeeCsv(rows: unknown[]): Promise<ActionResult<{ checks: CsvRowCheck[] }>> {
  await requireAdmin();
  if (!Array.isArray(rows) || rows.length === 0) return errResult("The file has no rows.");
  if (rows.length > 500) return errResult("Import at most 500 people at a time.");
  return okResult({ checks: checkRows(rows, await existingEmails()).checks });
}

export async function importEmployees(rows: unknown[], sendInvites: boolean): Promise<ActionResult<{ added: number; skipped: number; invited: number; inviteFailures: number }>> {
  await requireAdmin();
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) return errResult("Import between 1 and 500 people at a time.");
  const existing = await existingEmails();
  const { checks, valid } = checkRows(rows, existing);
  let skipped = checks.filter((c) => !c.ok).length;
  const supabase = await createClient();
  const idByEmail = new Map(existing);
  let added = 0, invited = 0, inviteFailures = 0;
  // First pass: insert everyone (no manager yet), second pass: link managers, so file order doesn't matter.
  const inserted: { email: string; person_id: string; managerEmail: string }[] = [];
  for (const v of valid) {
    const { data, error } = await supabase.from("acsia_people").insert(toRow(v.input)).select("person_id,email").single();
    if (error || !data) { skipped++; continue; }
    added++;
    idByEmail.set(data.email.toLowerCase(), data.person_id);
    inserted.push({ email: data.email, person_id: data.person_id, managerEmail: v.managerEmail });
  }
  for (const p of inserted) {
    const mid = p.managerEmail ? idByEmail.get(p.managerEmail) : undefined;
    if (mid) await supabase.from("acsia_people").update({ manager_id: mid }).eq("person_id", p.person_id);
  }
  if (sendInvites) {
    for (const p of inserted) {
      const o = await inviteOrMagicLink({ person_id: p.person_id, email: p.email });
      if (o.sent) { invited++; await markInvited(p.person_id); } else inviteFailures++;
    }
  }
  revalidatePath("/admin");
  return okResult({ added, skipped, invited, inviteFailures });
}

export const employeeCsvTemplate = async () => EMPLOYEE_CSV_COLUMNS.join(",") + "\n";

/* ------------------------------------------------------------------ settings */

export async function saveSettings(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return errResult(parsed.error.issues[0]?.message ?? "Check the form.");
  const supabase = await createClient();
  const rows = Object.entries(parsed.data).map(([key, value]) => ({ key, value }));
  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return errResult(friendlyDbError(error.message));
  revalidatePath("/admin/settings");
  return okResult(undefined);
}

/* ------------------------------------------------------------------ data import */

export async function runLibrarySeed(mode: SeedMode): Promise<ActionResult<{ report: SeedReport[] }>> {
  const { me } = await requireAdmin();
  if (mode !== "missing" && mode !== "reset") return errResult("Unknown mode.");
  try {
    const report = await applyReferenceSeed(createAdminClient(), mode);
    await auditNote("import", "library_seed", mode, report.map((r) => `${r.table}:${r.written}`).join(", "), me.email);
    revalidatePath("/admin/import");
    return okResult({ report });
  } catch (e) {
    return errResult(e instanceof Error ? e.message : "Seeding failed.");
  }
}
