import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/dates";

export interface ScoreRow { person_id: string; full_name: string; job_role: string | null; actions: number; target: number; pct: number | null; streak: number; ranked: boolean }
export interface Story { story_id: string; story_text: string | null; person_name: string; account_name: string; value_usd: number | null; status: string }
export interface ScorecardData {
  weekStart: string;
  status: string;                 // Draft | Awaiting commentary | Published (or "Not started")
  published: boolean;
  commentary: string;
  totals: { total_actions: number; participants: number; roster_size: number; participation_rate: number | null; proposals_raised: number; followups_made: number; opps_created: number } | null;
  ranked: ScoreRow[];
  unranked: { count: number; actions: number };
  rosterNames: string[];
  stories: Story[];
  featuredStoryId: string | null;
}

export async function loadScorecard(supabase: SupabaseClient, weekStart: string): Promise<ScorecardData> {
  const [sum, stats, week, stories] = await Promise.all([
    supabase.rpc("week_summary", { p_week: weekStart }),
    supabase.rpc("week_stats", { p_week: weekStart }),
    supabase.from("scorecard_weeks_safe").select("week_id, status, ceo_commentary, published_at, featured_story_ids").eq("week_start", weekStart).maybeSingle(),
    supabase.from("success_stories_safe").select("story_id, person_id, account_id, story_text, value_usd, status, created_at").gte("created_at", `${weekStart}T00:00:00+05:30`).lt("created_at", `${addDays(weekStart, 7)}T00:00:00+05:30`).in("status", ["Nominated", "Featured"]).order("created_at", { ascending: false }).limit(20),
  ]);
  const t = (sum.data ?? null) as Record<string, unknown> | null;
  const rows = ((stats.data ?? []) as { person_id: string; full_name: string; job_role: string | null; actions: number; weekly_target: number; show_on_ranked_scorecard: boolean; pct_of_target: number | null; streak_weeks: number }[])
    .map((r) => ({ person_id: r.person_id, full_name: r.full_name, job_role: r.job_role, actions: r.actions, target: r.weekly_target, pct: r.pct_of_target === null ? null : Math.round(Number(r.pct_of_target) * 100), streak: r.streak_weeks, ranked: r.show_on_ranked_scorecard }));
  const ranked = rows.filter((r) => r.ranked).sort((a, b) => b.actions - a.actions || a.full_name.localeCompare(b.full_name));
  const unranked = rows.filter((r) => !r.ranked);

  const st = (stories.data ?? []) as { story_id: string; person_id: string; account_id: string; story_text: string | null; value_usd: number | null; status: string }[];
  const personIds = [...new Set(st.map((s) => s.person_id))];
  const acctIds = [...new Set(st.map((s) => s.account_id))];
  const [people, accts] = await Promise.all([
    personIds.length ? supabase.from("acsia_people").select("person_id, full_name").in("person_id", personIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    acctIds.length ? supabase.from("accounts_safe").select("account_id, name").in("account_id", acctIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const pName = new Map((people.data ?? []).map((p) => [p.person_id as string, p.full_name as string]));
  const aName = new Map((accts.data ?? []).map((a) => [a.account_id as string, a.name as string]));
  const status = (week.data?.status as string | undefined) ?? "Not started";

  return {
    weekStart, status, published: status === "Published", commentary: (week.data?.ceo_commentary as string | null) ?? "",
    totals: t ? {
      total_actions: Number(t.total_actions ?? 0), participants: Number(t.participants ?? 0), roster_size: Number(t.roster_size ?? 0),
      participation_rate: t.participation_rate === null || t.participation_rate === undefined ? null : Number(t.participation_rate),
      proposals_raised: Number(t.proposals_raised ?? 0), followups_made: Number(t.followups_made ?? 0), opps_created: Number(t.opps_created ?? 0),
    } : null,
    ranked, unranked: { count: unranked.length, actions: unranked.reduce((s, r) => s + r.actions, 0) },
    rosterNames: rows.map((r) => r.full_name),
    stories: st.map((s) => ({ story_id: s.story_id, story_text: s.story_text, person_name: pName.get(s.person_id) ?? "Colleague", account_name: aName.get(s.account_id) ?? "", value_usd: s.value_usd, status: s.status })),
    featuredStoryId: ((week.data?.featured_story_ids as string[] | null) ?? [])[0] ?? null,
  };
}
