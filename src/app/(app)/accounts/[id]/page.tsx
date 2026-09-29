import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Page } from "@/components/shell/page";
import { requireNav } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRefData } from "@/lib/data/ref";
import { loadAccountDetail } from "@/lib/data/accounts";
import { recommend } from "@/lib/account-reco";
import { money } from "@/lib/format";
import { uuid } from "@/lib/types";
import { AccountSections } from "./sections";

export const metadata: Metadata = { title: "Account" };

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { me } = await requireNav("accounts");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const supabase = await createClient();
  const [a, ref] = await Promise.all([loadAccountDetail(supabase, me, id), getRefData()]);
  if (!a) notFound();

  const lineName = new Map(ref.serviceLines.map((l) => [l.service_line_id, l.name.replace(/ \(.*/, "")]));
  const known = new Set(a.whitespace.filter((w) => w.status !== "Unknown").map((w) => w.service_line_id));
  const reco = recommend({
    daysSinceTouch: a.days_since_touch, coveragePct: a.coverage_pct,
    contacts: a.contacts.filter((c) => c.status !== "Left company").map((c) => ({ name: c.name, days_since_touch: c.days_since_touch, strength: c.strength })),
    needs: a.needs.map((n) => ({ service: lineName.get(n.service_line_id) ?? "A service line", status: n.status })),
    unknownServices: ref.serviceLines.filter((l) => l.short_code !== "NONE" && !known.has(l.service_line_id)).map((l) => l.name.replace(/ \(.*/, "")),
    proposalsOverdue: a.proposalsOverdue, singleThreaded: a.contacts.filter((c) => c.status !== "Left company").length === 1,
  });

  return (
    <Page title={a.name} back={{ href: "/accounts", label: "Accounts" }}>
      <div className="chips">
        {a.tier && <span className="chip a">Tier {a.tier}</span>}
        {a.track && <span className="chip info">{a.track}</span>}
        {a.parent_name && <span className="chip">{a.parent_name} group</span>}
        {a.region && <span className="chip">{a.region}</span>}
      </div>
      <div className="kpis">
        <div className="kpi"><span>Service lines bought</span><b>{a.service_lines_bought ?? 0} / 15</b></div>
        <div className={`kpi ${a.coverage_pct !== null && a.coverage_pct < 10 ? "bad" : "ok"}`}><span>Buying group we know</span><b>{a.coverage_pct === null ? "–" : `${a.coverage_pct}%`}</b></div>
        <div className="kpi"><span>Days since proactive touch</span><b>{a.days_since_touch ?? "never"}</b></div>
        <div className="kpi"><span>{me.can_see_money ? "Open pipeline" : "Programmes"}</span><b>{me.can_see_money ? money(a.open_pipeline_usd) : a.programmes_count}</b></div>
      </div>
      <div className="op"><span className="dot"><Sparkles aria-hidden /></span><div><p><b>What to do here:</b> {reco}</p></div></div>
      <AccountSections a={a} lines={ref.serviceLines} showCompetitors={me.can_see_money} />
    </Page>
  );
}
