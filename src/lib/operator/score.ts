import "server-only";
/**
 * The Friday scorecard draft. Runs from the cron (Friday 14:00 IST) and from "Draft it for me" on the Scorecard screen.
 * The draft is stored next to the week (scorecard_weeks.ai_draft, visible only to the leader / CEO / admin). It never publishes anything and never
 * touches the commentary a person is editing: they choose to use it.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { scorePrompt } from "@/lib/operator/prompts";
import { runJob } from "@/lib/operator/run";
import { heuristicScore, scoreOutputSchema, toScorePrompt, validateScore, type ScoreDraft, type ScoreInput, type ScorePerson, type StoredDraft } from "@/lib/operator/score-core";

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

export type ScoreDraftResult =
  | { status: "drafted"; draft: StoredDraft }
  | { status: "published" | "quiet"; message: string };

export async function buildScoreInput(admin: Admin, weekStart: string): Promise<{ input: ScoreInput; weekId: string } | null> {
  const { data: week } = await admin.from("scorecard_weeks").select("week_id, proposals_raised, opps_created, followups_made, featured_story_ids").eq("week_start", weekStart).is("archived_at", null).maybeSingle();
  if (!week) return null;
  const weekId = String(week.week_id);
  const { data: stats } = await admin.from("person_week_stats").select("person_id, actions, target, participated, streak_weeks, by_code").eq("week_id", weekId).is("archived_at", null);
  const ids = ((stats ?? []) as Row[]).map((s) => String(s.person_id));
  const { data: people } = ids.length ? await admin.from("acsia_people").select("person_id, full_name").in("person_id", ids) : { data: [] as Row[] };
  const nameOf = new Map(((people ?? []) as Row[]).map((p) => [String(p.person_id), String(p.full_name)]));

  const rows: ScorePerson[] = ((stats ?? []) as Row[]).map((s) => {
    const full = nameOf.get(String(s.person_id)) ?? "";
    return {
      first: full.trim().split(/\s+/)[0] ?? "", full, actions: Number(s.actions ?? 0), target: Number(s.target ?? 0), streak: Number(s.streak_weeks ?? 0),
      participated: s.participated === true, codes: (s.by_code as Record<string, number> | null) ?? {},
    };
  }).filter((p) => p.full);

  const storyId = ((week.featured_story_ids as string[] | null) ?? [])[0];
  let story: ScoreInput["story"] = null;
  if (storyId) {
    const { data: st } = await admin.from("success_stories").select("story_text, person_id").eq("story_id", storyId).maybeSingle();
    if (st?.story_text) story = { by: nameOf.get(String(st.person_id))?.split(/\s+/)[0] ?? null, text: String(st.story_text) };
  }
  const total = rows.reduce((s, p) => s + p.actions, 0);
  return {
    weekId,
    input: {
      weekStart, people: rows, story,
      totals: { total_actions: total, participants: rows.filter((p) => p.participated).length, roster_size: rows.length, proposals_raised: Number(week.proposals_raised ?? 0), followups_made: Number(week.followups_made ?? 0), opps_created: Number(week.opps_created ?? 0) },
    },
  };
}

export async function draftScorecard(opts: { weekStart: string; personId: string | null }): Promise<ScoreDraftResult> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("freeze_week", { p_week: opts.weekStart });
  if (error) {
    if (/ALREADY_PUBLISHED/.test(error.message)) return { status: "published", message: "This week is already published, so there is nothing to draft." };
    throw new Error(`freeze_week failed: ${error.message}`);
  }
  const built = await buildScoreInput(admin, opts.weekStart);
  if (!built) return { status: "quiet", message: "There is no data for this week yet." };
  const { input, weekId } = built;

  const { data: caps } = await admin.from("capabilities").select("name").eq("do_not_offer", true).is("archived_at", null);
  const blocked = ((caps ?? []) as Row[]).map((c) => String(c.name));

  let draft: ScoreDraft | null = null;
  let source: "ai" | "rules" = "rules";
  let runId: string | null = null;
  let note: string | null = null;

  const ai = await runJob("score", scorePrompt(toScorePrompt(input)), { ctx: { personId: opts.personId, inputRef: { week: opts.weekStart, people: input.people.length } }, schema: scoreOutputSchema });
  if (ai.ok) {
    const check = validateScore(ai.data, input, blocked);
    if (check.ok) { draft = check.draft; source = "ai"; runId = ai.runId; }
    else note = `The AI's draft was set aside (${check.reason}), so this one is written from the week's numbers.`;
  } else note = ai.reason === "no_key" ? "The AI operator isn't connected yet, so this draft is written from the week's numbers."
    : ai.reason === "budget" ? "This month's AI budget is used up, so this draft is written from the week's numbers."
    : ai.reason === "disabled" ? "The scorecard writer is switched off, so this draft is written from the week's numbers."
    : "The AI operator couldn't help just now, so this draft is written from the week's numbers.";

  if (!draft) draft = heuristicScore(input);
  if (!draft) return { status: "quiet", message: "Fewer than two people have logged anything this week, so there is nobody to name yet." };

  const stored: StoredDraft = { ...draft, source, run_id: runId, generated_at: new Date().toISOString(), note };
  const { error: upErr } = await admin.from("scorecard_weeks").update({ ai_draft: stored }).eq("week_id", weekId).neq("status", "Published");
  if (upErr) throw new Error(`could not save the draft: ${upErr.message}`);
  return { status: "drafted", draft: stored };
}
