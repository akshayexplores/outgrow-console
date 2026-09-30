/** Pure pieces of the scheduled jobs (no I/O, no server-only), so they can be unit-tested: names, periods, summaries, the bearer check. */
import { timingSafeEqual } from "node:crypto";
import { todayIST, weekStartOf } from "@/lib/dates";

export const CRON_JOBS = ["daily", "monday", "friday", "monthly"] as const;
export type CronJob = (typeof CRON_JOBS)[number];
export const isCronJob = (v: string): v is CronJob => (CRON_JOBS as readonly string[]).includes(v);

export const CRON_LABEL: Record<CronJob, { title: string; when: string; what: string }> = {
  daily: { title: "Daily refresh", when: "Every day, 06:00", what: "Refreshes contacts mapped, coverage, next-touch dates and the who-to-call lists." },
  monday: { title: "Monday plan", when: "Mondays, 07:00", what: "Drafts this week's assignments for managers to approve." },
  friday: { title: "Friday scorecard draft", when: "Fridays, 14:00", what: "Freezes the week's numbers and drafts the commentary." },
  monthly: { title: "Quarterly review", when: "1st of the month", what: "Reads the last 13 weeks. Skipped until programme week 12." },
};

/** The idempotency key for a run: the same key is never claimed twice. Days and weeks are Asia/Kolkata days and Monday-start weeks. */
export function periodKey(job: CronJob, now: Date = new Date()): string {
  const today = todayIST(now);
  switch (job) {
    case "daily": return today;
    case "monday":
    case "friday": return weekStartOf(today);
    case "monthly": return today.slice(0, 7);
  }
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

/** One line a leader can read for a finished job. Details come from job_runs.detail, which only the cron runner writes. */
export function summariseRun(job: CronJob, status: string, detail: Row | null): string {
  const d = detail ?? {};
  if (status === "error") return `Failed: ${String(d.message ?? "unknown error").slice(0, 140)}`;
  if (status === "running") return "Running now, or stopped part-way (a new run can take over after 15 minutes).";
  if (status === "skipped") return String(d.message ?? d.note ?? "Skipped: nothing to do.");
  switch (job) {
    case "daily": { const l = (d.lists ?? {}) as Row; const x = (d.derived ?? {}) as Row; return `${num(x.accounts_updated)} accounts and ${num(x.contacts_updated)} contacts refreshed. Lists: ${num(l.added)} added, ${num(l.exited)} left, ${num(l.open)} open.`; }
    case "monday": return `${num(d.drafted)} draft assignment${num(d.drafted) === 1 ? "" : "s"} (${num(d.from_ai)} by the AI, ${num(d.from_rules)} by the plain rules).${d.note ? ` ${String(d.note)}` : ""}`;
    case "friday": return `Scorecard draft ready (${d.source === "ai" ? "AI-written" : "written from the numbers"}).${d.note ? ` ${String(d.note)}` : ""}`;
    case "monthly": return `Review ready for programme week ${num(d.programme_week)}.`;
  }
}

/** Constant-time check of "Authorization: Bearer <secret>". An empty secret never matches. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret) return false;
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}
