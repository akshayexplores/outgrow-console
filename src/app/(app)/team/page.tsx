import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Page } from "@/components/shell/page";
import { requireNav } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTeam } from "@/lib/data/team";
import { InboxList } from "../today/today-client";
import { PlanBoard, RedraftButton, Roster } from "./team-client";

export const metadata: Metadata = { title: "Team" };

const TABS = [["monday", "Monday plan"], ["week", "This week"], ["inbox", "From engineers"]] as const;

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { me } = await requireNav("team");
  const wide = me.is_admin || me.app_role === "leader";
  const { tab: raw } = await searchParams;
  const tab = TABS.some(([k]) => k === raw) ? raw! : "monday";
  const supabase = await createClient();
  const d = await loadTeam(supabase);
  const drafts = d.plan.filter((p) => p.status === "Draft").length;
  const participating = d.roster.filter((r) => r.participated).length;
  const total = d.roster.reduce((s, r) => s + r.actions, 0);

  return (
    <Page title="Team" wide>
      <div className="tabs" role="tablist" aria-label="Team views">
        {TABS.map(([k, label]) => (
          <Link key={k} role="tab" aria-selected={tab === k} href={`/team?tab=${k}`} replace scroll={false}>
            {k === "inbox" ? `${label} (${d.inbox.length})` : k === "monday" && drafts ? `${label} (${drafts} to approve)` : label}
          </Link>
        ))}
      </div>

      {tab === "monday" && (
        <>
          <div className="op"><span className="dot"><Sparkles aria-hidden /></span><div>
            <p>{drafts ? <>There {drafts === 1 ? "is" : "are"} <b>{drafts}</b> draft assignment{drafts === 1 ? "" : "s"} waiting. Approve, edit or drop each one; people only see approved cards.</> : "Nothing is waiting for approval. Add assignments by hand below, or ask the planner for a draft."}</p>
            <div className="why">The planner drafts these from your who-to-call lists every Monday at 07:00. It can only pick people who have a line to the contact, approved plays, and channels the contact allows.</div>
            <div style={{ marginTop: 8 }}><RedraftButton drafts={d.plan.filter((p) => p.status === "Draft" && p.operator_draft).length} scopeLabel={wide ? "everyone" : "your team"} /></div>
          </div></div>
          <PlanBoard plan={d.plan} />
          <div className="sech"><h2>Huddle agenda · 15 minutes</h2></div>
          <div className="card rows">
            <div className="rowi"><div><b>2 min</b> · actions vs last week, participation, proposals raised</div></div>
            <div className="rowi"><div><b>3 min</b> · one or two stories by name, plus a 30-second customer clip</div></div>
            <div className="rowi"><div><b>10 min</b> · confirm these assignments and who covers shared accounts</div></div>
          </div>
        </>
      )}

      {tab === "week" && (
        <>
          <div className="kpis">
            <div className="kpi"><span>Actions this week</span><b>{total}</b></div>
            <div className="kpi"><span>Participating</span><b>{participating} / {d.roster.length}</b></div>
            <div className="kpi"><span>Assignments done</span><b>{d.assignmentsDone} / {d.assignmentsTotal}</b></div>
            <div className="kpi"><span>Notes waiting</span><b>{d.inbox.length}</b></div>
          </div>
          <Roster rows={d.roster} />
        </>
      )}

      {tab === "inbox" && <InboxList items={d.inbox} />}
    </Page>
  );
}
