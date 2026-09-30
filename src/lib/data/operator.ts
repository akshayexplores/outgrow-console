import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { CRON_JOBS, CRON_LABEL, summariseRun, type CronJob } from "@/lib/jobs/schedule";
import { JOB_KEYS, JOB_LABEL, type JobKey } from "@/lib/operator/types";

type Row = Record<string, unknown>;

export interface JobStats { runs: number; ok: number; fallback: number; invalid: number; failed: number; blocked: number; limited: number; avg_ms: number; p95_ms: number; cost_usd: number; accepted: number; decided: number }
export interface RouteRow { job: JobKey; label: string; human_role: string; primary_model: string; fallback_model: string | null; temperature: number; max_tokens: number; enabled: boolean; stats: JobStats | null }
export interface CronRow { job: CronJob; title: string; when: string; what: string; last: { period: string; status: string; at: string; summary: string } | null }
export interface ReviewData { period: string; programme_week: number; source: string; review: string; watch: string[]; by_code: { code: string; actions: number; opportunities: number; enough_data: boolean; rate: number | null }[] }
export interface RecentRun { id: string; created_at: string; job: string; label: string; model: string; status: string; latency_ms: number | null; cost_usd: number | null; error: string | null }
export interface OperatorData {
  keyConnected: boolean; cronConfigured: boolean; budget: number; monthCost: number; programmeWeek: number;
  routes: RouteRow[]; crons: CronRow[]; review: ReviewData | null; recent: RecentRun[];
}

const num = (v: unknown) => Number(v ?? 0);

export async function loadOperator(supabase: SupabaseClient): Promise<OperatorData> {
  const env = serverEnv();
  const [routesRes, dashRes, costRes, jobsRes, recentRes, weekRes] = await Promise.all([
    supabase.from("ai_routes").select("job, primary_model, fallback_model, temperature, max_tokens, enabled, human_role"),
    supabase.rpc("ai_dashboard", { p_days: 30 }),
    supabase.rpc("ai_month_cost"),
    supabase.from("job_runs").select("job, period_key, status, started_at, finished_at, detail").order("started_at", { ascending: false }).limit(60),
    supabase.from("ai_runs").select("id, created_at, job, model, status, latency_ms, cost_usd, error").order("created_at", { ascending: false }).limit(25),
    supabase.rpc("programme_week"),
  ]);

  const stats = new Map<string, JobStats>();
  for (const s of (dashRes.data ?? []) as Row[]) {
    stats.set(String(s.job), { runs: num(s.runs), ok: num(s.ok), fallback: num(s.fallback), invalid: num(s.invalid), failed: num(s.failed), blocked: num(s.blocked), limited: num(s.limited), avg_ms: num(s.avg_ms), p95_ms: num(s.p95_ms), cost_usd: num(s.cost_usd), accepted: num(s.accepted), decided: num(s.decided) });
  }
  const routeRows = new Map(((routesRes.data ?? []) as Row[]).map((r) => [String(r.job), r]));
  const routes: RouteRow[] = JOB_KEYS.flatMap((job) => {
    const r = routeRows.get(job);
    if (!r) return [];
    return [{ job, label: JOB_LABEL[job], human_role: String(r.human_role ?? ""), primary_model: String(r.primary_model), fallback_model: (r.fallback_model as string | null) ?? null, temperature: num(r.temperature), max_tokens: num(r.max_tokens), enabled: r.enabled === true, stats: stats.get(job) ?? null }];
  });

  const runs = (jobsRes.data ?? []) as Row[];
  const crons: CronRow[] = CRON_JOBS.map((job) => {
    const last = runs.find((r) => r.job === job);
    return {
      job, ...CRON_LABEL[job],
      last: last ? { period: String(last.period_key), status: String(last.status), at: String(last.finished_at ?? last.started_at), summary: summariseRun(job, String(last.status), (last.detail as Row | null) ?? null) } : null,
    };
  });

  const rv = runs.find((r) => r.job === "monthly" && r.status === "ok");
  const d = (rv?.detail ?? null) as Row | null;
  const review: ReviewData | null = rv && d && typeof d.review === "string"
    ? { period: String(rv.period_key), programme_week: num(d.programme_week), source: String(d.source ?? ""), review: d.review, watch: Array.isArray(d.watch) ? d.watch.map(String) : [], by_code: Array.isArray(d.by_code) ? (d.by_code as Row[]).map((b) => ({ code: String(b.code), actions: num(b.actions), opportunities: num(b.opportunities), enough_data: b.enough_data === true, rate: b.rate == null ? null : num(b.rate) })) : [] }
    : null;

  return {
    keyConnected: !!env.OPENROUTER_API_KEY, cronConfigured: !!env.CRON_SECRET, budget: env.AI_MONTHLY_BUDGET_USD,
    monthCost: num(costRes.data), programmeWeek: num(weekRes.data), routes, crons, review,
    recent: ((recentRes.data ?? []) as Row[]).map((r) => ({ id: String(r.id), created_at: String(r.created_at), job: String(r.job), label: JOB_LABEL[r.job as JobKey] ?? String(r.job), model: String(r.model), status: String(r.status), latency_ms: r.latency_ms == null ? null : num(r.latency_ms), cost_usd: r.cost_usd == null ? null : num(r.cost_usd), error: (r.error as string | null) ?? null })),
  };
}
