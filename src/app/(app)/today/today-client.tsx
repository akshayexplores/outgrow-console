"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { useShell } from "@/components/shell/shell-context";
import { dismissCapture, submitCapture } from "@/app/actions/log";
import { initials, firstName } from "@/lib/format";
import type { AssignmentCard, InboxRow } from "@/lib/data/today";

export function AssignmentList({ items }: { items: AssignmentCard[] }) {
  const { openLog, openPrep, canLog } = useShell();
  if (items.length === 0) return <div className="empty">No assignments this week.</div>;
  return (
    <div className="list">
      {items.map((a) => {
        const done = a.status !== "Open";
        return (
          <div key={a.assignment_id} className={`card task${done ? " done" : ""}`}>
            <span className="av" aria-hidden>{initials(a.contact_name)}</span>
            <div>
              <h3>{a.contact_name} {a.account_name && <span className="sub" style={{ fontWeight: 500 }}>· {a.account_name}</span>}</h3>
              <div className="chips" style={{ marginTop: 4 }}>
                {a.why && <span className="chip a">{a.why}</span>}
                {a.play_id && <span className="chip">{a.play_id}</span>}
                {done && <span className="chip ok">{a.status}</span>}
              </div>
              {!done && <div className="instr">{a.instruction}</div>}
            </div>
            <div className="acts">
              {!done && a.contact_id && <button className="btn" onClick={() => openPrep({ contactId: a.contact_id!, assignmentId: a.assignment_id })}>Prep</button>}
              {!done && canLog && <button className="btn p" onClick={() => openLog({ assignmentId: a.assignment_id, contactId: a.contact_id ?? undefined })}>Log</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m || 1} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function InboxList({ items }: { items: InboxRow[] }) {
  const { openLog, toast } = useShell();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (items.length === 0) return <div className="empty">Nothing waiting. When an engineer sends a note, it appears here.</div>;
  return (
    <div className="list">
      {items.map((i) => (
        <div key={i.id} className="card task">
          <span className="av" aria-hidden>{initials(i.from_name)}</span>
          <div><h3>{i.from_name} <span className="sub" style={{ fontWeight: 500 }}>· {ago(i.created_at)}</span></h3><div className="instr">{i.text}</div></div>
          <div className="acts">
            <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await dismissCapture(i.id); if (!r.ok) toast(r.error); else router.refresh(); })}>Dismiss</button>
            <button className="btn p" onClick={() => openLog({ inboxId: i.id, proxyPersonId: i.from_person_id, text: i.text })}>Log for {firstName(i.from_name)}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EngineerNote({ managerName }: { managerName: string | null }) {
  const { toast } = useShell();
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="card" style={{ display: "grid", gap: 10 }} onSubmit={(e) => {
      e.preventDefault();
      setError(null);
      start(async () => {
        const r = await submitCapture(text);
        if (!r.ok) { setError(r.error); return; }
        setText(""); toast("Sent. Your manager will log it."); router.refresh();
      });
    }}>
      <label className="lbl" htmlFor="eng-note">What did the customer mention?
        <textarea id="eng-note" className="in" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
          placeholder="e.g. Suresh said the AVB/TSN test is slipping and they may need two people from January." />
      </label>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn acc" type="submit" disabled={pending || text.trim().length < 5}><Send size={14} aria-hidden />Send{managerName ? ` to ${firstName(managerName)}` : " to your manager"}</button>
        <span className="demo">One line is enough.</span>
      </div>
    </form>
  );
}
