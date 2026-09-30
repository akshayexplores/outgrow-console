import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { Page } from "@/components/shell/page";
import { requireNav } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadOperator } from "@/lib/data/operator";
import { fmtDateTime } from "@/lib/dates";
import { actionLabel } from "@/lib/outgrow";
import { RATES_FROM_WEEK } from "@/lib/operator/analyst-core";
import { RouteEditor, RunNow } from "./operator-client";

export const metadata: Metadata = { title: "Operator" };
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;
const STATUS: Record<string, string> = { ok: "ok", fallback_used: "used backup model", invalid_output: "unreadable answer", error: "error", blocked_by_guardrail: "guardrail edited it", rate_limited: "rate limited", budget_exceeded: "over budget" };
const tone = (s: string) => (s === "ok" || s === "skipped" ? "ok" : s === "error" || s === "invalid_output" ? "bad" : "warn");

export default async function OperatorPage() {
  await requireNav("operator");
  const d = await loadOperator(await createClient());
  const pctUsed = d.budget > 0 ? Math.min(100, Math.round((d.monthCost / d.budget) * 100)) : 0;

  return (
    <Page title="Operator" wide>
      <div className="op"><span className="dot"><Sparkles aria-hidden /></span><div>
        <p>The operator drafts and suggests; people decide. Nothing it writes is final until a person accepts it, and it never changes a deal stage.</p>
        <div className="why">Guardrails run in code before and after every model call. Numbers below are for the last 30 days.</div>
      </div></div>

      <div className="kpis">
        <div className={`kpi ${d.keyConnected ? "ok" : "bad"}`}><span>AI key</span><b style={{ fontSize: 16 }}>{d.keyConnected ? "Connected" : "Not connected"}</b></div>
        <div className={`kpi ${pctUsed >= 80 ? "bad" : ""}`}><span>Spend this month</span><b>{usd(d.monthCost)}</b><span>of {usd(d.budget)} budget ({pctUsed}%)</span></div>
        <div className={`kpi ${d.cronConfigured ? "ok" : "bad"}`}><span>Scheduled jobs</span><b style={{ fontSize: 16 }}>{d.cronConfigured ? "Configured" : "Not configured"}</b></div>
        <div className="kpi"><span>Programme week</span><b>{d.programmeWeek || "–"}</b><span>rates unlock in week {RATES_FROM_WEEK}</span></div>
      </div>
      {!d.keyConnected && <div className="warnbox" role="status" style={{ marginBottom: 14 }}>No AI key is set, so every screen shows its plain form and the Monday plan is written by simple rules. Add OPENROUTER_API_KEY in the hosting settings to switch the operator on.</div>}
      {!d.cronConfigured && <div className="warnbox" role="status" style={{ marginBottom: 14 }}>CRON_SECRET is not set, so the scheduled jobs refuse to run. You can still run each one below by hand.</div>}

      <div className="sech"><h2>Scheduled jobs</h2><small>Asia/Kolkata time</small></div>
      <div className="card rows">
        {d.crons.map((c) => (
          <div className="rowi" key={c.job} style={{ alignItems: "start" }}>
            <div>
              <b>{c.title}</b> <span className="sub">· {c.when}</span>
              <div className="sub">{c.what}</div>
              {c.last
                ? <div style={{ marginTop: 4, fontSize: 12.5 }}><span className={`chip ${tone(c.last.status)}`}>{c.last.status}</span> <span className="sub">{c.last.period} · {fmtDateTime(c.last.at)}</span><div>{c.last.summary}</div></div>
                : <div className="sub" style={{ marginTop: 4 }}>Has not run yet.</div>}
            </div>
            <RunNow job={c.job} title={c.title} careful={c.job === "monday" || c.job === "monthly"} />
          </div>
        ))}
      </div>

      <div className="sech"><h2>Jobs and models</h2><small>change a model without a deploy</small></div>
      {d.routes.length === 0 && <div className="empty">No jobs are set up yet. Load the library first (Admin, then Data import).</div>}
      <div className="card" style={{ padding: "4px 14px" }}>
        <div className="tblw">
          <table>
            <thead><tr><th>Job</th><th>Model</th><th className="n">Runs</th><th className="n">Worked</th><th className="n">Avg s</th><th className="n">Cost</th><th className="n">Taken</th><th /></tr></thead>
            <tbody>
              {d.routes.map((r) => {
                const s = r.stats;
                const worked = s && s.runs ? Math.round(((s.ok + s.fallback + s.blocked) / s.runs) * 100) : null;
                return (
                  <tr key={r.job}>
                    <td><b>{r.label}</b>{!r.enabled && <span className="chip warn" style={{ marginLeft: 6 }}>off</span>}<div className="sub" style={{ fontSize: 12, color: "var(--muted)" }}>{r.human_role}</div></td>
                    <td style={{ fontSize: 12.5 }}>{r.primary_model}{r.fallback_model && <div style={{ color: "var(--muted)" }}>backup: {r.fallback_model}</div>}</td>
                    <td className="n">{s?.runs ?? 0}</td>
                    <td className="n">{worked === null ? "–" : `${worked}%`}</td>
                    <td className="n">{s && s.runs ? (s.avg_ms / 1000).toFixed(1) : "–"}</td>
                    <td className="n">{s ? usd(s.cost_usd) : "–"}</td>
                    <td className="n">{s && s.decided ? `${s.accepted}/${s.decided}` : "–"}</td>
                    <td><RouteEditor route={r} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="demo" style={{ margin: "8px 0" }}>Worked = answered with a usable result (backup model included). Taken = how many drafts people accepted, out of the ones they decided on.</div>
      </div>

      <div className="sech"><h2>Quarterly review</h2><small>hidden until programme week {RATES_FROM_WEEK}</small></div>
      {d.review ? (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="demo">Programme week {d.review.programme_week} · {d.review.source === "ai" ? "written by the AI from these numbers" : "written from the numbers"} · every rate below is computed in the database</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{d.review.review}</div>
          {d.review.watch.length > 0 && <div className="warnbox">{d.review.watch.map((w) => <div key={w}>{w}</div>)}</div>}
          <div className="tblw"><table>
            <thead><tr><th>Ask</th><th className="n">Actions</th><th className="n">Opportunities</th><th className="n">Rate</th></tr></thead>
            <tbody>{d.review.by_code.map((b) => (
              <tr key={b.code}><td>{b.code} · {actionLabel(b.code)}</td><td className="n">{b.actions}</td><td className="n">{b.opportunities}</td><td className="n">{b.enough_data && b.rate !== null ? `${Math.round(b.rate * 1000) / 10}%` : "not enough data"}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : (
        <div className="locked">{d.programmeWeek >= RATES_FROM_WEEK ? "The first review is written on the 1st of the month, or run it above." : `Conversion rates unlock in programme week ${RATES_FROM_WEEK} (this is week ${d.programmeWeek || 0}). Until then the console counts swings and quotes no rates.`}</div>
      )}

      <div className="sech"><h2>Recent runs</h2><small>last 25</small></div>
      <div className="card" style={{ padding: "4px 14px" }}>
        {d.recent.length === 0 ? <div className="empty">Nothing has run yet.</div> : (
          <div className="tblw"><table>
            <thead><tr><th>When</th><th>Job</th><th>Model</th><th>Result</th><th className="n">Sec</th><th className="n">Cost</th></tr></thead>
            <tbody>{d.recent.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td><td>{r.label}</td><td style={{ fontSize: 12 }}>{r.model}</td>
                <td><span className={`chip ${tone(r.status)}`}>{STATUS[r.status] ?? r.status}</span>{r.error && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.error.slice(0, 120)}</div>}</td>
                <td className="n">{r.latency_ms == null ? "–" : (r.latency_ms / 1000).toFixed(1)}</td><td className="n">{r.cost_usd == null ? "–" : `$${r.cost_usd.toFixed(4)}`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </Page>
  );
}
