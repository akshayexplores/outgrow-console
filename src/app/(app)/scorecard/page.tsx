import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell/page";
import { requireNav } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadScorecard } from "@/lib/data/scorecard";
import { addDays, fmtDate, todayIST, weekStartOf } from "@/lib/dates";
import { CommentaryBox } from "./commentary";

export const metadata: Metadata = { title: "Friday scorecard" };

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { me } = await requireNav("scorecard");
  const { week: raw } = await searchParams;
  const thisWeek = weekStartOf(todayIST());
  const week = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= thisWeek ? weekStartOf(raw) : thisWeek;
  const supabase = await createClient();
  const d = await loadScorecard(supabase, week);
  const t = d.totals;
  const canPublish = me.is_admin || me.app_role === "ceo" || me.app_role === "leader";
  const featured = d.stories.find((s) => s.story_id === d.featuredStoryId) ?? d.stories[0];

  return (
    <Page title="Friday scorecard" wide>
      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <Link className="btn sm" href={`/scorecard?week=${addDays(week, -7)}`} aria-label="Previous week">←</Link>
        <b>Week of {fmtDate(week, { day: "numeric", month: "short", year: "numeric" })}</b>
        {week < thisWeek && <Link className="btn sm" href={`/scorecard?week=${addDays(week, 7)}`} aria-label="Next week">→</Link>}
        <span className={`chip ${d.published ? "ok" : ""}`}>{d.published ? "Published" : "Not published"}</span>
      </div>

      {t && (
        <div className="kpis">
          <div className="kpi"><span>Actions</span><b>{t.total_actions}</b></div>
          <div className={`kpi ${t.participation_rate !== null && t.participation_rate >= 0.6 ? "ok" : ""}`}><span>Participation</span><b>{t.participation_rate === null ? "–" : `${Math.round(t.participation_rate * 100)}%`}</b></div>
          <div className="kpi"><span>Proposals raised</span><b>{t.proposals_raised}</b></div>
          <div className="kpi"><span>Proposal follow-ups</span><b>{t.followups_made}</b></div>
        </div>
      )}
      <div className="locked" style={{ marginBottom: 14 }}>No closed revenue or win rates on the scorecard for the first two quarters. It counts swings, not results.</div>

      <div className="sech"><h2>Story of the week</h2></div>
      <div className="card">
        {featured
          ? <p style={{ margin: 0 }}><b>{featured.person_name}</b>{featured.account_name ? ` · ${featured.account_name}` : ""}: {featured.story_text || "Nominated without a note."}</p>
          : <p style={{ margin: 0, color: "var(--muted)" }}>No story nominated yet. When someone saves a log and ticks “Nominate this as a story”, it appears here.</p>}
      </div>

      <div className="sech"><h2>This week</h2><small>engineers are counted but not ranked</small></div>
      <div className="card" style={{ padding: "4px 14px" }}>
        <div className="tblw">
          <table>
            <thead><tr><th>#</th><th>Person</th><th className="n">Actions</th><th className="n">vs target</th><th className="n">Streak</th></tr></thead>
            <tbody>
              {d.ranked.map((r, i) => (
                <tr key={r.person_id}><td>{i + 1}</td><td>{r.full_name}{r.job_role && <span style={{ color: "var(--muted)", fontSize: 12 }}> · {r.job_role}</span>}</td><td className="n">{r.actions}</td><td className="n">{r.pct === null ? "–" : `${r.pct}%`}</td><td className="n">{r.streak}</td></tr>
              ))}
              {d.unranked.count > 0 && (
                <tr><td>–</td><td style={{ color: "var(--muted)" }}>{d.unranked.count} delivery engineers and architects</td><td className="n">{d.unranked.actions}</td><td className="n">—</td><td className="n">—</td></tr>
              )}
              {d.ranked.length === 0 && d.unranked.count === 0 && <tr><td colSpan={5}><div className="empty">Nobody is on the roster yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sech"><h2>{d.published ? "Published commentary" : "Your commentary"}</h2><small>{d.published ? "" : "two sentences, name two people"}</small></div>
      {d.published ? (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div className="okbox">Published to all {t?.roster_size ?? 0} people on the roster.</div>
          <p style={{ margin: 0 }}>“{d.commentary}”</p>
        </div>
      ) : week < thisWeek ? (
        <div className="empty">This week wasn't published.</div>
      ) : (
        <CommentaryBox week={week} initial={d.commentary} rosterNames={d.rosterNames} canPublish={canPublish} stories={d.stories} defaultStory={d.featuredStoryId} rosterSize={t?.roster_size ?? 0} />
      )}
    </Page>
  );
}
