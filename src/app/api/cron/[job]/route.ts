import { serverEnv } from "@/lib/env";
import { runCronJob } from "@/lib/jobs/cron";
import { bearerMatches, isCronJob } from "@/lib/jobs/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Vercel Cron calls this with GET and "Authorization: Bearer $CRON_SECRET". Without CRON_SECRET configured the endpoint refuses everything (503),
 * so an unconfigured deployment can't be triggered by strangers. The job itself is idempotent per period.
 */
export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  let secret = "";
  try { secret = serverEnv().CRON_SECRET; } catch { return reply(503, { message: "The server environment is incomplete." }); }
  if (!secret) return reply(503, { message: "Scheduled jobs are not configured (CRON_SECRET is not set)." });
  if (!bearerMatches(req.headers.get("authorization"), secret)) return reply(401, { message: "Not authorised." });
  const { job } = await ctx.params;
  if (!isCronJob(job)) return reply(404, { message: "Unknown job." });
  const out = await runCronJob(job);
  return reply(out.status === "error" ? 500 : 200, { job: out.job, period: out.period, status: out.status, detail: out.detail });
}
