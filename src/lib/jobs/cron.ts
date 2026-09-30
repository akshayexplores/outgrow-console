import "server-only";
/**
 * Scheduled jobs (Vercel Cron, Asia/Kolkata). Each job claims a (job, period) row first, so a retried or doubled request never runs twice:
 *   daily   06:00  refresh stored fields + "who to call" lists
 *   monday  07:00  Monday planner drafts assignments for approval
 *   friday  14:00  freeze the week and draft the scorecard commentary
 *   monthly 1st    quarterly analyst (skipped until programme week 12)
 * The Operator screen can also run any of them now (force), which takes over a finished period on purpose.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { periodKey, type CronJob } from "@/lib/jobs/schedule";
import { runAnalyst } from "@/lib/operator/analyst";
import { runPlanner } from "@/lib/operator/plan";
import { draftScorecard } from "@/lib/operator/score";

export { CRON_JOBS, CRON_LABEL, isCronJob, periodKey, type CronJob } from "@/lib/jobs/schedule";

export type CronOutcome = { job: CronJob; period: string; status: "ok" | "skipped" | "already_done" | "error"; detail: Record<string, unknown> };

type Admin = ReturnType<typeof createAdminClient>;

async function tellLeaders(admin: Admin, roles: string[], title: string, body: string, link: string) {
  const { data } = await admin.from("acsia_people").select("person_id").in("app_role", roles).eq("active", true).is("archived_at", null);
  const rows = (data ?? []).map((p) => ({ person_id: String(p.person_id), kind: "operator", title, body, link }));
  if (rows.length) await admin.from("notifications").insert(rows);
}

export async function runCronJob(job: CronJob, opts: { force?: boolean; personId?: string | null; now?: Date } = {}): Promise<CronOutcome> {
  const admin = createAdminClient();
  const period = periodKey(job, opts.now);
  const { data: claimed, error: claimErr } = await admin.rpc("claim_job_run", { p_job: job, p_period: period, p_force: !!opts.force });
  if (claimErr) return { job, period, status: "error", detail: { message: `could not claim the job: ${claimErr.message}` } };
  if (!claimed) return { job, period, status: "already_done", detail: { message: "This period has already run (or is running now)." } };

  let status: "ok" | "skipped" = "ok";
  let detail: Record<string, unknown> = {};
  try {
    switch (job) {
      case "daily": {
        const [d, l] = await Promise.all([admin.rpc("refresh_derived"), admin.rpc("refresh_list_memberships")]);
        if (d.error) throw new Error(`refresh_derived: ${d.error.message}`);
        if (l.error) throw new Error(`refresh_list_memberships: ${l.error.message}`);
        detail = { derived: d.data, lists: l.data };
        break;
      }
      case "monday": {
        const l = await admin.rpc("refresh_list_memberships");
        if (l.error) throw new Error(`refresh_list_memberships: ${l.error.message}`);
        const r = await runPlanner({ weekStart: period, personId: opts.personId ?? null, replace: false, notify: true });
        detail = { lists: l.data, drafted: r.drafted, skipped: r.skipped, from_ai: r.fromAi, from_rules: r.fromRules, source: r.source, note: r.note, run_id: r.runId };
        if (r.source === "none") status = "skipped";
        break;
      }
      case "friday": {
        const r = await draftScorecard({ weekStart: period, personId: opts.personId ?? null });
        if (r.status === "drafted") {
          detail = { status: r.status, source: r.draft.source, names: r.draft.names, note: r.draft.note, run_id: r.draft.run_id };
          await tellLeaders(admin, ["leader", "ceo"], "The Friday scorecard draft is ready", "Review the operator's commentary, edit it, and publish.", "/scorecard").catch(() => undefined);
        } else { detail = { status: r.status, message: r.message }; status = "skipped"; }
        break;
      }
      case "monthly": {
        const r = await runAnalyst({ personId: opts.personId ?? null });
        if (r.status === "skipped") { status = "skipped"; detail = { message: r.reason, programme_week: r.programme_week }; }
        else {
          detail = { programme_week: r.programme_week, source: r.source, run_id: r.run_id, removed: r.removed, by_code: r.by_code, review: r.review, watch: r.watch, generated_at: r.generated_at };
          await tellLeaders(admin, ["leader"], "The quarterly review is ready", "Programme week " + r.programme_week + ". Open the Operator screen to read it.", "/operator").catch(() => undefined);
        }
        break;
      }
    }
    await admin.rpc("finish_job_run", { p_job: job, p_period: period, p_status: status, p_detail: detail });
    return { job, period, status, detail };
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 400) : "unknown error";
    await admin.rpc("finish_job_run", { p_job: job, p_period: period, p_status: "error", p_detail: { message } });
    return { job, period, status: "error", detail: { message } };
  }
}
