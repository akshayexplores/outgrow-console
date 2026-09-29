"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell/shell-context";
import { decidePlay, decideProofPoint, signOffTestimonial } from "@/app/actions/library";
import type { Approval, PlayRow } from "@/lib/data/library";

export function PlaysTable({ plays, types }: { plays: PlayRow[]; types: string[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return plays.filter((p) => (!type || p.play_type === type) && (!term || `${p.play_id} ${p.title} ${p.script}`.toLowerCase().includes(term)));
  }, [plays, q, type]);
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <label className="sr-only" htmlFor="play-q">Search plays</label>
        <input id="play-q" className="in" style={{ maxWidth: 280 }} placeholder="Search plays…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr-only" htmlFor="play-type">Play type</label>
        <select id="play-type" className="in" style={{ maxWidth: 220 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="demo" style={{ alignSelf: "center" }}>{rows.length} of {plays.length}</span>
      </div>
      <div className="card" style={{ padding: "4px 14px" }}>
        <div className="tblw">
          <table>
            <thead><tr><th>Play</th><th>Type</th><th>Raise</th><th>Priority</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <Fragment key={p.play_id}>
                  <tr className="click" tabIndex={0} aria-expanded={open === p.play_id} onClick={() => setOpen(open === p.play_id ? null : p.play_id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === p.play_id ? null : p.play_id); } }}>
                    <td className="mono" style={{ fontSize: 12 }}>{p.play_id}</td><td>{p.play_type}</td><td>{p.title}</td><td>{p.priority ?? "–"}</td>
                    <td><span className={`chip ${/^Approved/.test(p.approval_status) ? "ok" : p.approval_status === "Retired" ? "bad" : "warn"}`}>{p.approval_status.replace(" - internal", "")}</span></td>
                  </tr>
                  {open === p.play_id && (
                    <tr><td /><td colSpan={4} style={{ background: "var(--surface2)" }}>
                      “{p.script}”
                      {p.trigger && <div className="demo">When: {p.trigger}</div>}
                      {p.proof && <div className="demo">Proof: {p.proof}</div>}
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={5}><div className="empty">No plays match.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="demo" style={{ marginTop: 8 }}>Only approved plays reach the field. Drafts are visible to the Outgrow Leader only.</div>
    </>
  );
}

export function ApprovalList({ items }: { items: Approval[] }) {
  const { toast } = useShell();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (items.length === 0) return <div className="empty">Nothing waiting for approval.</div>;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? "That didn't work."); else { toast(done); router.refresh(); }
  });
  return (
    <div className="list">
      {items.map((a) => (
        <div className="card task" key={`${a.kind}-${a.id}`}>
          <span className={`chip ${a.kind === "Play" ? "info" : a.kind === "Testimonial" ? "a" : "warn"}`}>{a.kind}</span>
          <div><h3>{a.title}</h3><div className="sub">{a.detail}</div></div>
          <div className="acts">
            {a.kind === "Play" && <>
              <button className="btn sm" disabled={pending} onClick={() => run(() => decidePlay({ playId: a.id, decision: "retire" }), "Retired")}>Reject</button>
              <button className="btn sm p" disabled={pending} onClick={() => run(() => decidePlay({ playId: a.id, decision: "approve" }), "Approved. It can reach the field now.")}>Approve</button>
            </>}
            {a.kind === "Proof point" && <>
              <button className="btn sm" disabled={pending} onClick={() => run(() => decideProofPoint({ id: a.id, decision: "retire" }), "Retired")}>Reject</button>
              <button className="btn sm p" disabled={pending} onClick={() => run(() => decideProofPoint({ id: a.id, decision: "approve" }), "Approved")}>Approve</button>
            </>}
            {a.kind === "Testimonial" && <button className="btn sm p" disabled={pending} onClick={() => run(() => signOffTestimonial(a.id), "Signed off")}>Sign off</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
