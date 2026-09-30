"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isCronJob, runCronJob } from "@/lib/jobs/cron";
import { JOB_KEYS } from "@/lib/operator/types";
import { errResult, friendlyDbError, okResult, type ActionResult } from "@/lib/types";

/** Model slugs look like "vendor/model" or "vendor/model:variant". Checked here so a typo can't be saved as a route. */
const slug = z.string().trim().min(3).max(120).regex(/^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Use a model name like vendor/model-name.");

const routeSchema = z.object({
  job: z.enum(JOB_KEYS),
  primary_model: slug,
  fallback_model: z.union([slug, z.literal("")]).optional(),
  temperature: z.coerce.number().min(0, "Temperature is between 0 and 1.").max(1, "Temperature is between 0 and 1."),
  max_tokens: z.coerce.number().int().min(100, "At least 100 tokens.").max(8000, "At most 8,000 tokens."),
  enabled: z.boolean(),
});

const NOT_LEADER = "Only the Outgrow leader or the admin can do that.";
const isLeader = (s: Awaited<ReturnType<typeof requireActionSession>>) => s.me.is_admin || s.me.app_role === "leader";

export async function updateRoute(raw: unknown): Promise<ActionResult> {
  const s = await requireActionSession();
  if (!isLeader(s)) return errResult(NOT_LEADER);
  const p = routeSchema.safeParse(raw);
  if (!p.success) return errResult(p.error.issues[0]?.message ?? "Check the values.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("ai_routes").update({
    primary_model: p.data.primary_model, fallback_model: p.data.fallback_model || null, temperature: p.data.temperature, max_tokens: p.data.max_tokens, enabled: p.data.enabled,
  }).eq("job", p.data.job).select("job");
  if (error) return errResult(friendlyDbError(error.message));
  if (!data?.length) return errResult("That job doesn't exist yet. Load the library first (Admin, then Data import).");
  revalidatePath("/operator");
  return okResult(undefined);
}

const runSchema = z.object({ job: z.string() });

/** "Run now" for a scheduled job. It takes over the current period on purpose, so use it after fixing whatever stopped the scheduled run. */
export async function runJobNow(raw: unknown): Promise<ActionResult<{ status: string; message: string }>> {
  const s = await requireActionSession();
  if (!isLeader(s)) return errResult(NOT_LEADER);
  const p = runSchema.safeParse(raw);
  if (!p.success || !isCronJob(p.data.job)) return errResult("Unknown job.");
  const out = await runCronJob(p.data.job, { force: true, personId: s.me.person_id });
  for (const path of ["/operator", "/team", "/scorecard", "/today"]) revalidatePath(path);
  if (out.status === "error") return errResult(String(out.detail.message ?? "The job failed."));
  const d = out.detail as Record<string, unknown>;
  const message = out.status === "skipped" ? String(d.message ?? d.note ?? "Nothing to do right now.")
    : out.job === "monday" ? `${d.drafted ?? 0} draft assignment${d.drafted === 1 ? "" : "s"} added.${d.note ? " " + String(d.note) : ""}`
    : out.job === "friday" ? "Scorecard draft is ready on the Scorecard screen."
    : out.job === "monthly" ? "The quarterly review is ready below."
    : "Lists and stored fields refreshed.";
  return okResult({ status: out.status, message });
}
