import "server-only";
/** The quarterly analyst run. Skipped until programme week 12; cron runs it on the 1st of each month. */
import { createAdminClient } from "@/lib/supabase/admin";
import { analystPrompt } from "@/lib/operator/prompts";
import { runJob } from "@/lib/operator/run";
import { RATES_FROM_WEEK, allowedPercents, analystDataSchema, analystOutputSchema, filterAnalystText, heuristicAnalyst, toAnalystPrompt, type AnalystData } from "@/lib/operator/analyst-core";

export interface AnalystResult {
  status: "ok" | "skipped";
  reason?: string;
  programme_week: number;
  review?: string;
  watch?: string[];
  by_code?: AnalystData["by_code"];
  source?: "ai" | "rules";
  run_id?: string | null;
  removed?: number;
  generated_at?: string;
}

export async function runAnalyst(opts: { personId: string | null }): Promise<AnalystResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("analyst_input");
  if (error) throw new Error(`analyst_input failed: ${error.message}`);
  const parsed = analystDataSchema.safeParse(data);
  if (!parsed.success) throw new Error("analyst_input returned an unexpected shape");
  const d = parsed.data;
  if (d.programme_week < RATES_FROM_WEEK) return { status: "skipped", reason: `Conversion rates unlock in programme week ${RATES_FROM_WEEK} (this is week ${d.programme_week}).`, programme_week: d.programme_week };

  const ai = await runJob("analyst", analystPrompt(toAnalystPrompt(d)), { ctx: { personId: opts.personId, inputRef: { programme_week: d.programme_week, codes: d.by_code.length } }, schema: analystOutputSchema, allowConversion: true });
  let review: string; let watch: string[]; let source: "ai" | "rules" = "rules"; let removed = 0; const runId = ai.ok ? ai.runId : null;
  if (ai.ok) {
    const allowed = allowedPercents(d);
    const r = filterAnalystText(ai.data.review, allowed);
    const w = ai.data.watch.map((x) => filterAnalystText(x, allowed)).filter((x) => x.text);
    removed = r.removed + w.reduce((s, x) => s + x.removed, 0);
    if (r.text.length >= 40) { review = r.text; watch = w.map((x) => x.text); source = "ai"; }
    else ({ review, watch } = heuristicAnalyst(d));
  } else ({ review, watch } = heuristicAnalyst(d));
  return { status: "ok", programme_week: d.programme_week, review, watch, by_code: d.by_code, source, run_id: runId, removed, generated_at: new Date().toISOString() };
}
