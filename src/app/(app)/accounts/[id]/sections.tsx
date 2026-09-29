"use client";
import { useState } from "react";
import { useShell } from "@/components/shell/shell-context";
import { fmtDate } from "@/lib/dates";
import type { AccountDetail } from "@/lib/data/accounts";

const WS_LABEL: Record<string, { cls: string; text: string }> = {
  "Buying from Acsia": { cls: "b", text: " ✓" },
  "Held by competitor": { cls: "c", text: " · competitor" },
  "Need likely": { cls: "n", text: " · need likely" },
  "Need confirmed - unsourced": { cls: "n", text: " · need confirmed" },
  "In-house": { cls: "", text: " · in-house" },
  "Acsia can't offer": { cls: "", text: " · we can't offer" },
  "Not relevant": { cls: "", text: " · n/a" },
};

function Section({ title, meta, defaultOpen, children }: { title: string; meta?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`acc-sec${open ? " open" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{title} <span>{meta}</span><i>›</i></button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function Strength({ n }: { n: number | null }) {
  const v = Math.max(0, Math.min(5, n ?? 0));
  return <span className="strength" role="img" aria-label={n === null ? "Relationship strength unknown" : `Relationship strength ${v} of 5`}>{"●".repeat(v)}<i>{"●".repeat(5 - v)}</i></span>;
}

export function AccountSections({ a, lines, showCompetitors }: { a: AccountDetail; lines: { service_line_id: string; name: string; short_code: string }[]; showCompetitors: boolean }) {
  const { openPrep } = useShell();
  const real = lines.filter((l) => l.short_code !== "NONE");
  const status = new Map(a.whitespace.map((w) => [w.service_line_id, w.status]));
  return (
    <>
      <Section title="People" meta={`${a.contacts.length} mapped`} defaultOpen>
        {a.contacts.length === 0 ? <div className="empty">No contacts mapped yet.</div> : (
          <div className="rows">{a.contacts.map((c) => (
            <div className="rowi" key={c.contact_id}>
              <div><b>{c.name}</b>{c.job_title ? <> · {c.job_title}</> : null}
                <div className="sub">{[c.buying_role, c.days_since_touch === null ? "never called" : `last called ${c.days_since_touch} d ago`].filter(Boolean).join(" · ")} · <Strength n={c.strength} /></div></div>
              {c.status !== "Left company" && <button className="btn sm" onClick={() => openPrep({ contactId: c.contact_id })}>Prep a call</button>}
            </div>
          ))}</div>
        )}
        <div className="demo" style={{ marginTop: 8 }}>About 30 people typically sit in a buying group. Ask for internal referrals to find the rest.</div>
      </Section>
      <Section title="Whitespace" meta="who holds each service line">
        <div className="ws">{real.map((l) => {
          const s = status.get(l.service_line_id);
          const w = s ? WS_LABEL[s] : undefined;
          return <span key={l.service_line_id} className={w?.cls ?? ""}>{l.name.replace(/ \(.*/, "")}{w ? w.text : " ?"}</span>;
        })}</div>
        {showCompetitors && a.competitors.length > 0 && <div className="demo" style={{ marginTop: 8 }}>Known competitors: {a.competitors.join(", ")}</div>}
      </Section>
      <Section title="Departments" meta={String(a.units.length)}>
        {a.units.length === 0 ? <div className="empty">No departments mapped yet.</div> : (
          <div className="rows">{a.units.map((u) => (
            <div className="rowi" key={u.org_unit_id}><div>{u.name}</div>{u.acsia_presence && <span className={`chip ${u.acsia_presence === "None known" ? "warn" : u.acsia_presence.startsWith("Active") ? "ok" : ""}`}>{u.acsia_presence}</span>}</div>
          ))}</div>
        )}
      </Section>
      <Section title="Programmes" meta={`${a.programmes.length} on record`}>
        {a.programmes.length === 0 ? <div className="empty">No programmes on record.</div> : (
          <div className="rows">{a.programmes.map((p) => (
            <div className="rowi" key={p.programme_id}><div><b>{p.name}</b><div className="sub">{[p.status, p.current_headcount ? `${p.current_headcount} people` : null].filter(Boolean).join(" · ")}</div></div>{p.health && <span className={`chip ${/red|at risk/i.test(p.health) ? "bad" : /green|healthy/i.test(p.health) ? "ok" : ""}`}>{p.health}</span>}</div>
          ))}</div>
        )}
      </Section>
      <Section title="Recent swings" meta={`${a.recent.length} in 14 days`}>
        {a.recent.length === 0 ? <div className="empty">No swings logged here in the last two weeks.</div> : (
          <div className="rows">{a.recent.map((r) => (
            <div className="rowi" key={r.touch_id}><div><b>{r.person_name}</b>{r.contact_name ? <> → {r.contact_name}</> : null}<div className="sub">{fmtDate(r.date)} · {r.summary}</div></div><span className="chip ok">+{r.n}</span></div>
          ))}</div>
        )}
      </Section>
    </>
  );
}
