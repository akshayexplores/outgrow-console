import "server-only";
/**
 * The one place the app talks to a language model (docs/04). Every AI feature goes through runJob() or streamJob().
 *
 * Order of events for every call:
 *   1. key present? job enabled? per-user rate limit? monthly budget?    (all in code, before any model is called)
 *   2. primary model, then fallback on timeout / 5xx / empty / unreadable output
 *   3. output validated with zod, then scrubbed for conversion rates and forecasts (docs/04 rule 6)
 *   4. one ai_runs row per call, so leaders can see cost, latency and acceptance in the Operator screen
 * The model never writes deal stages or owners; normalise.ts strips those keys from anything it produced.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import aiRoutesJson from "../../../seed/ai_routes.json";
import { appUrl, serverEnv } from "@/lib/env";
import { todayIST } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseJsonLoose } from "@/lib/operator/json";
import { SentenceGuard, scrubConversion } from "@/lib/operator/guardrails";
import { OpenRouterError, chat, streamChat, type ChatUsage } from "@/lib/operator/openrouter";
import {
  FAILURE_COPY, INTERACTIVE_JOBS, JOB_TIER, TIMEOUT_MS, type JobKey, type JobResult, type Msg, type RunFailure, type Route,
} from "@/lib/operator/types";

export const RATE_PER_MINUTE = 10;
export const RATE_PER_DAY = 200;

export interface RunCtx {
  /** The signed-in employee the call is for (null for cron jobs). Used for rate limits and for the run log. */
  personId: string | null;
  /** Small, non-personal reference for the run log (ids and counts, never the note text). */
  inputRef?: Record<string, unknown>;
}

type Admin = ReturnType<typeof createAdminClient>;

/* ------------------------------------------------------------------ routes */

const SEED_ROUTES = new Map<string, Route>(
  (aiRoutesJson as { routes: Route[] }).routes.map((r) => [r.job, { job: r.job, primary_model: r.primary_model, fallback_model: r.fallback_model ?? null, temperature: Number(r.temperature), max_tokens: Number(r.max_tokens), enabled: r.enabled }]),
);

/** Routes are edited in the Operator screen and stored in ai_routes; the shipped seed is only the fallback if the table has no row. */
export async function loadRoute(admin: Admin, job: JobKey): Promise<Route | null> {
  const { data } = await admin.from("ai_routes").select("job, primary_model, fallback_model, temperature, max_tokens, enabled").eq("job", job).maybeSingle();
  if (data) {
    return { job, primary_model: data.primary_model as string, fallback_model: (data.fallback_model as string | null) || null, temperature: Number(data.temperature), max_tokens: Number(data.max_tokens), enabled: !!data.enabled };
  }
  return SEED_ROUTES.get(job) ?? null;
}

/* ------------------------------------------------------------------ checks before any model call */

interface Gate { ok: true; admin: Admin; route: Route; apiKey: string }
type GateResult = Gate | { ok: false; reason: RunFailure; message: string; runId: string | null };

const hash = (m: Msg[]) => createHash("sha256").update(JSON.stringify(m)).digest("hex").slice(0, 16);

async function logRun(admin: Admin, row: {
  job: JobKey; model: string; personId: string | null; inputRef?: Record<string, unknown>; promptHash?: string; output?: unknown;
  status: "ok" | "invalid_output" | "error" | "fallback_used" | "blocked_by_guardrail" | "rate_limited" | "budget_exceeded";
  error?: string; latencyMs?: number; usage?: ChatUsage;
}): Promise<string | null> {
  const { data, error } = await admin.from("ai_runs").insert({
    job: row.job, model: row.model, person_id: row.personId, input_ref: row.inputRef ?? null, prompt_hash: row.promptHash ?? null,
    output: row.output === undefined ? null : row.output, status: row.status, error: row.error ? row.error.slice(0, 500) : null,
    latency_ms: row.latencyMs ?? null, tokens_in: row.usage?.tokensIn ?? null, tokens_out: row.usage?.tokensOut ?? null, cost_usd: row.usage?.costUsd ?? null,
  }).select("id").single();
  return error ? null : (data.id as string);
}

async function alertBudgetOnce(admin: Admin, spent: number, budget: number, monthKey: string) {
  const { data: seen } = await admin.from("app_settings").select("value").eq("key", "ai_budget_alert_month").maybeSingle();
  if (seen?.value === monthKey) return;
  await admin.from("app_settings").upsert({ key: "ai_budget_alert_month", value: monthKey, updated_at: new Date().toISOString() });
  const { data: leaders } = await admin.from("acsia_people").select("person_id").in("app_role", ["leader", "ceo"]).eq("active", true).is("archived_at", null);
  const rows = (leaders ?? []).map((l) => ({
    person_id: l.person_id as string, kind: "ai_budget", title: "AI spend is at 80% of this month's budget",
    body: `$${spent.toFixed(2)} of $${budget.toFixed(0)} used. When it reaches the budget the operator switches itself off and forms stay available.`, link: "/operator",
  }));
  if (rows.length) await admin.from("notifications").insert(rows);
}

async function gate(job: JobKey, ctx: RunCtx): Promise<GateResult> {
  const env = serverEnv();
  const fail = (reason: RunFailure, runId: string | null = null): GateResult => ({ ok: false, reason, message: FAILURE_COPY[reason], runId });
  if (!env.OPENROUTER_API_KEY) return fail("no_key");
  const admin = createAdminClient();
  const route = await loadRoute(admin, job);
  if (!route || !route.enabled) return fail("disabled");

  const monthStart = `${todayIST().slice(0, 7)}-01T00:00:00+05:30`;
  const { data: usage } = await admin.rpc("ai_usage", { p_person: ctx.personId ?? "00000000-0000-0000-0000-000000000000", p_month_start: monthStart });
  const u = (Array.isArray(usage) ? usage[0] : usage) as { last_minute: number; last_day: number; month_cost: number | string } | null;

  if (ctx.personId && INTERACTIVE_JOBS.includes(job) && u && (u.last_minute >= RATE_PER_MINUTE || u.last_day >= RATE_PER_DAY)) {
    const id = await logRun(admin, { job, model: route.primary_model, personId: ctx.personId, inputRef: ctx.inputRef, status: "rate_limited" });
    return fail("rate_limited", id);
  }
  const spent = Number(u?.month_cost ?? 0);
  const budget = env.AI_MONTHLY_BUDGET_USD;
  if (spent >= budget) {
    const id = await logRun(admin, { job, model: route.primary_model, personId: ctx.personId, inputRef: ctx.inputRef, status: "budget_exceeded" });
    return fail("budget", id);
  }
  if (spent >= budget * 0.8) await alertBudgetOnce(admin, spent, budget, monthStart.slice(0, 7)).catch(() => undefined);
  return { ok: true, admin, route, apiKey: env.OPENROUTER_API_KEY };
}

/** Errors that a second model can't fix (bad key, no credit, blocked): stop instead of burning a second call. */
const isTerminal = (e: unknown) => e instanceof OpenRouterError && e.kind === "http" && (e.status === 401 || e.status === 402 || e.status === 403);

/* ------------------------------------------------------------------ deep scrub for conversion rates */

function scrubStrings(value: unknown, counter: { removed: number }): unknown {
  if (typeof value === "string") { const r = scrubConversion(value); counter.removed += r.removed; return r.text; }
  if (Array.isArray(value)) return value.map((v) => scrubStrings(v, counter));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubStrings(v, counter);
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ runJob: JSON in, validated object out */

export interface RunJobOptions<T> {
  ctx: RunCtx;
  schema: z.ZodType<T>;
  /** The Quarterly analyst may quote conversion rates once measurement is live (week 12); every other job may not. */
  allowConversion?: boolean;
}

export async function runJob<T>(job: JobKey, messages: Msg[], opts: RunJobOptions<T>): Promise<JobResult<T>> {
  const g = await gate(job, opts.ctx);
  if (!g.ok) return g;
  const { admin, route, apiKey } = g;
  const started = Date.now();
  const models = [route.primary_model, ...(route.fallback_model && route.fallback_model !== route.primary_model ? [route.fallback_model] : [])];
  let lastError = "";
  let lastKind: "invalid" | "error" = "error";

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    try {
      const r = await chat({ apiKey, referer: appUrl(), model, messages, temperature: route.temperature, maxTokens: route.max_tokens, json: true, timeoutMs: TIMEOUT_MS[JOB_TIER[job]] });
      const parsed = parseJsonLoose(r.text);
      const valid = parsed === null ? null : opts.schema.safeParse(parsed);
      if (!valid || !valid.success) {
        lastKind = "invalid";
        lastError = valid ? valid.error.issues.slice(0, 3).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") : "not valid JSON";
        continue;
      }
      let data: T = valid.data;
      let removed = 0;
      if (!opts.allowConversion) {
        const counter = { removed: 0 };
        data = scrubStrings(data, counter) as T;
        removed = counter.removed;
      }
      const runId = await logRun(admin, {
        job, model, personId: opts.ctx.personId, inputRef: opts.ctx.inputRef, promptHash: hash(messages), output: data,
        status: removed > 0 ? "blocked_by_guardrail" : i > 0 ? "fallback_used" : "ok",
        error: removed > 0 ? `${removed} sentence(s) with a conversion rate or forecast were removed` : undefined,
        latencyMs: Date.now() - started, usage: r,
      });
      return { ok: true, data, runId, model, fallbackUsed: i > 0, latencyMs: Date.now() - started };
    } catch (e) {
      lastKind = "error";
      lastError = e instanceof Error ? e.message : "unknown error";
      if (isTerminal(e)) break;
    }
  }
  const runId = await logRun(admin, {
    job, model: models[models.length - 1]!, personId: opts.ctx.personId, inputRef: opts.ctx.inputRef, promptHash: hash(messages),
    status: lastKind === "invalid" ? "invalid_output" : "error", error: lastError, latencyMs: Date.now() - started,
  });
  return { ok: false, reason: lastKind, message: FAILURE_COPY[lastKind], runId };
}

/* ------------------------------------------------------------------ streamJob: plain text out, one sentence at a time */

export type StreamStart =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; reason: RunFailure; message: string; runId: string | null };

/**
 * Streams the model's answer as plain UTF-8 text. Text is released a sentence at a time so a sentence quoting a conversion rate or
 * forecast can be replaced before the person sees it. If the first model fails before producing text, the fallback model is tried.
 */
export async function streamJob(job: JobKey, messages: Msg[], ctx: RunCtx): Promise<StreamStart> {
  const g = await gate(job, ctx);
  if (!g.ok) return g;
  const { admin, route, apiKey } = g;
  const enc = new TextEncoder();
  const models = [route.primary_model, ...(route.fallback_model && route.fallback_model !== route.primary_model ? [route.fallback_model] : [])];
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastError = "";
      for (let i = 0; i < models.length; i++) {
        const model = models[i]!;
        const guard = new SentenceGuard();
        let sent = false;
        let usage: ChatUsage | undefined;
        let whole = "";
        try {
          for await (const ev of streamChat({ apiKey, referer: appUrl(), model, messages, temperature: route.temperature, maxTokens: route.max_tokens, timeoutMs: TIMEOUT_MS[JOB_TIER[job]] })) {
            if ("usage" in ev) { usage = ev.usage; continue; }
            const out = guard.push(ev.delta);
            if (out) { sent = true; whole += out; controller.enqueue(enc.encode(out)); }
          }
          const tail = guard.flush();
          if (tail) { sent = true; whole += tail; controller.enqueue(enc.encode(tail)); }
          await logRun(admin, {
            job, model, personId: ctx.personId, inputRef: ctx.inputRef, promptHash: hash(messages), output: { text: whole.slice(0, 2000) },
            status: guard.removed > 0 ? "blocked_by_guardrail" : i > 0 ? "fallback_used" : "ok",
            error: guard.removed > 0 ? `${guard.removed} sentence(s) with a conversion rate or forecast were removed` : undefined,
            latencyMs: Date.now() - started, usage,
          });
          controller.close();
          return;
        } catch (e) {
          lastError = e instanceof Error ? e.message : "unknown error";
          if (sent) {
            // Some text is already on screen: don't restart with another model; end the answer honestly.
            const note = "\n\n(The answer was cut short. Ask again if you need the rest.)";
            controller.enqueue(enc.encode(note));
            await logRun(admin, { job, model, personId: ctx.personId, inputRef: ctx.inputRef, promptHash: hash(messages), status: "error", error: lastError, latencyMs: Date.now() - started, usage });
            controller.close();
            return;
          }
          if (isTerminal(e)) break;
        }
      }
      await logRun(admin, { job, model: models[models.length - 1]!, personId: ctx.personId, inputRef: ctx.inputRef, promptHash: hash(messages), status: "error", error: lastError, latencyMs: Date.now() - started });
      controller.enqueue(enc.encode("The operator couldn't answer just now. Try again in a moment."));
      controller.close();
    },
  });
  return { ok: true, stream };
}
