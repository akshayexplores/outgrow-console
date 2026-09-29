export const JOB_KEYS = ["capture", "transcribe", "follow", "brief", "plan", "score", "coach", "guard", "analyst"] as const;
export type JobKey = (typeof JOB_KEYS)[number];
export type Tier = "quick" | "balanced" | "deep";

/** Latency tier per job (docs/04): quick 15 s, balanced 45 s, deep 120 s. */
export const JOB_TIER: Record<JobKey, Tier> = {
  capture: "quick", transcribe: "quick", follow: "quick", brief: "balanced", plan: "deep", score: "balanced", coach: "balanced", guard: "quick", analyst: "deep",
};
export const TIMEOUT_MS: Record<Tier, number> = { quick: 15_000, balanced: 45_000, deep: 120_000 };

/** Jobs a person triggers by clicking something: these are rate-limited per user. Cron jobs (plan, score, analyst) are not. */
export const INTERACTIVE_JOBS: readonly JobKey[] = ["capture", "follow", "brief", "coach", "guard", "transcribe"];

export const JOB_LABEL: Record<JobKey, string> = {
  capture: "Capture parser", transcribe: "Voice notes", follow: "Follow-through", brief: "Call brief", plan: "Monday planner",
  score: "Scorecard writer", coach: "Ask Outgrow", guard: "Guardrail check", analyst: "Quarterly analyst",
};

export interface Route { job: JobKey; primary_model: string; fallback_model: string | null; temperature: number; max_tokens: number; enabled: boolean }

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export type RunFailure = "disabled" | "no_key" | "rate_limited" | "budget" | "blocked" | "invalid" | "error";
export type JobResult<T> =
  | { ok: true; data: T; runId: string | null; model: string; fallbackUsed: boolean; latencyMs: number }
  | { ok: false; reason: RunFailure; message: string; runId: string | null };

/** Human copy for each failure, shown under the fallback form ("the operator couldn't help, so here is the plain form"). */
export const FAILURE_COPY: Record<RunFailure, string> = {
  disabled: "This operator job is switched off, so the plain form is shown.",
  no_key: "The AI operator isn't connected yet, so the plain form is shown.",
  rate_limited: "Too many AI requests just now. Try again in a minute; the plain form is shown meanwhile.",
  budget: "This month's AI budget is used up, so the plain form is shown.",
  blocked: "That answer was held back by a guardrail.",
  invalid: "The operator's answer couldn't be read, so the plain form is shown.",
  error: "The operator couldn't answer just now, so the plain form is shown.",
};
