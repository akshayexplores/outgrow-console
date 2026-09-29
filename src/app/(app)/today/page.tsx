import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { requireNav } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadToday } from "@/lib/data/today";
import { fmtDate, monthName } from "@/lib/dates";
import { plural } from "@/lib/format";
import { Sparkles } from "lucide-react";
import { AssignmentList, EngineerNote, InboxList } from "./today-client";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const { me } = await requireNav("today");
  const supabase = await createClient();
  const d = await loadToday(supabase, me);

  // The operator's nudge on this screen is deterministic: it reads the assignments and the week's count, and needs no model.
  const left = d.assignments.filter((a) => a.status === "Open");
  const doneCount = d.assignments.length - left.length;
  const first = left[0];

  if (me.app_role === "engineer") {
    return (
      <Page title="Today">
        <p className="lead">You don't need to log anything here. When a customer mentions something, send one line and your manager will log it.</p>
        <EngineerNote managerName={null} />
        <div className="sech"><h2>This month's question</h2><small>{d.focusMonth ? `${monthName(d.focusMonth)} · on your prompt card` : "on your prompt card"}</small></div>
        <div className="card">
          <p style={{ margin: "0 0 6px", fontSize: 16, fontFamily: "var(--display)" }}>“{d.focusQuestion}”</p>
          <div className="sub" style={{ color: "var(--muted)", fontSize: 13 }}>Ask it once, at the end of a conversation that's already happening. Then stop and listen.</div>
        </div>
        <div className="sech"><h2>Your notes this month</h2></div>
        {d.myNotes.length === 0
          ? <div className="empty">Nothing sent yet.</div>
          : <div className="card rows">{d.myNotes.map((n) => (
              <div className="rowi" key={n.id}><div>{n.text}<div className="sub">{fmtDate(n.created_at.slice(0, 10))}</div></div>{n.status === "logged" ? <span className="chip ok">Logged</span> : n.status === "dismissed" ? <span className="chip">Set aside</span> : <span className="chip">Sent</span>}</div>
            ))}</div>}
      </Page>
    );
  }

  const stat = d.stat;
  const pct = stat && stat.target > 0 ? Math.min(100, (stat.actions / stat.target) * 100) : 0;
  const nudge = first
    ? <>Start with <b>{first.contact_name}</b>{first.why ? <>: {first.why.charAt(0).toLowerCase() + first.why.slice(1)}</> : null}.</>
    : <>{d.assignments.length ? "All of this week's swings are done." : "No assignments this week yet."} Anything else you heard? Log it.</>;

  return (
    <Page title="Your week">
      <div className="op"><span className="dot"><Sparkles aria-hidden /></span>
        <div><p>{nudge}</p>
          <div className="why">{d.assignments.length ? `${left.length} of ${d.assignments.length} assigned swings left${d.approverName ? ` · ${d.approverName} approved them on Monday` : ""}.` : "Your manager approves the plan on Monday; it appears here."}</div>
        </div>
      </div>
      {stat && (
        <div className="progress">
          <b>{stat.actions}</b>
          <div style={{ flex: 1 }}>
            <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={stat.target} aria-valuenow={Math.min(stat.actions, stat.target)} aria-label="Actions this week against your target"><i style={{ width: `${pct}%` }} /></div>
            <span>{stat.participated ? "Target reached. You're counted as participating this week." : `${Math.max(0, stat.threshold - stat.actions)} more to be counted as participating (target ${stat.target})`} · streak {stat.streak} wk</span>
          </div>
        </div>
      )}
      <div className="sech"><h2>This week's swings</h2><small>{doneCount} done</small></div>
      <AssignmentList items={d.assignments} />
      {me.app_role === "delivery_lead" && (
        <>
          <div className="sech"><h2>From your engineers</h2><small>they text, you log</small></div>
          <InboxList items={d.inbox} />
        </>
      )}
      {d.logged.length > 0 && (
        <>
          <div className="sech"><h2>Logged this week</h2><small>{plural(d.logged.length, "conversation")}</small></div>
          <div className="card rows">{d.logged.map((l) => (
            <div className="rowi" key={l.touch_id}><div><b>{l.contact_name}</b> <span className="sub">· {l.summary}</span></div><span className="chip ok">+{l.n}</span></div>
          ))}</div>
        </>
      )}
    </Page>
  );
}
