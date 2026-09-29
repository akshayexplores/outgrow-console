"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ContactPicker } from "@/components/contact-picker";
import { useShell } from "@/components/shell/shell-context";
import { approveAssignments, createAssignment, dropAssignments, loadAssignOptions, updateAssignment, type AssignOptions } from "@/app/actions/assignments";
import { loadContactChoices } from "@/app/actions/log";
import type { ContactLite } from "@/lib/log";
import { SELECTABLE_ACTION_CODES } from "@/lib/outgrow";
import type { PlanRow, RosterRow } from "@/lib/data/team";

function PlanItem({ row }: { row: PlanRow }) {
  const { toast } = useShell();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [instruction, setInstruction] = useState(row.instruction);
  const [why, setWhy] = useState(row.why_now ?? "");
  const [error, setError] = useState<string | null>(null);
  const draft = row.status === "Draft";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => {
    const r = await fn();
    if (!r.ok) { setError(r.error ?? "That didn't work."); return; }
    setError(null); setEdit(false); toast(ok); router.refresh();
  });

  return (
    <div className={`draft ${draft ? "new" : "ok"}`}>
      <div style={{ minWidth: 0 }}>
        <div className="who">{row.assignee_name} → {row.contact_name}{row.account_name ? ` · ${row.account_name}` : ""}{row.why ? ` · ${row.why}` : ""}</div>
        {edit ? (
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            <label className="lbl" htmlFor={`ins-${row.assignment_id}`}>Instruction
              <textarea id={`ins-${row.assignment_id}`} className="in" value={instruction} maxLength={500} onChange={(e) => setInstruction(e.target.value)} />
            </label>
            <label className="lbl" htmlFor={`why-${row.assignment_id}`}>Why now (short)
              <input id={`why-${row.assignment_id}`} className="in" value={why} maxLength={60} onChange={(e) => setWhy(e.target.value)} />
            </label>
            {error && <div className="errbox" role="alert">{error}</div>}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn sm p" disabled={pending} onClick={() => run(() => updateAssignment({ id: row.assignment_id, instruction, why_now: why }), "Saved")}>Save</button>
              <button className="btn sm" onClick={() => { setEdit(false); setInstruction(row.instruction); setWhy(row.why_now ?? ""); setError(null); }}>Cancel</button>
            </div>
          </div>
        ) : <div className="t">{row.instruction}</div>}
        {!edit && error && <div className="errbox" role="alert" style={{ marginTop: 6 }}>{error}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end" }}>
        {draft ? (
          <>
            {!edit && <button className="btn sm" disabled={pending} onClick={() => setEdit(true)}>Edit</button>}
            <button className="btn sm" disabled={pending} onClick={() => run(() => dropAssignments([row.assignment_id]), "Dropped")}>Drop</button>
            <button className="btn sm p" disabled={pending} onClick={() => run(() => approveAssignments([row.assignment_id]), "Approved. They can see it now.")}>Approve</button>
          </>
        ) : (
          <>
            {row.status === "Open" && !edit && <button className="btn sm" disabled={pending} onClick={() => setEdit(true)}>Edit</button>}
            <span className={`chip ${row.status === "Done" ? "ok" : ""}`}>{row.status === "Open" ? "Approved · open" : row.status}</span>
          </>
        )}
      </div>
    </div>
  );
}

function AddAssignment() {
  const { toast } = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<AssignOptions | null>(null);
  const [suggested, setSuggested] = useState<ContactLite[]>([]);
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [assignee, setAssignee] = useState("");
  const [instruction, setInstruction] = useState("");
  const [why, setWhy] = useState("");
  const [play, setPlay] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || opts) return;
    loadAssignOptions().then((r) => { if (r.ok) setOpts(r.data); });
    loadContactChoices({}).then((r) => { if (r.ok) setSuggested(r.data.suggested); });
  }, [open, opts]);

  if (!open) return <button className="btn" onClick={() => setOpen(true)}><Plus size={14} aria-hidden />Add an assignment</button>;
  return (
    <form className="card" style={{ display: "grid", gap: 10 }} onSubmit={(e) => {
      e.preventDefault();
      if (!contact) { setError("Choose the contact."); return; }
      start(async () => {
        const r = await createAssignment({ assignee_id: assignee, contact_id: contact.contact_id, instruction, why_now: why, suggested_play_id: play, expected_action_code: code });
        if (!r.ok) { setError(r.error); return; }
        toast("Assigned. They've been notified."); setOpen(false); setContact(null); setInstruction(""); setWhy(""); setPlay(""); setCode(""); setError(null); router.refresh();
      });
    }}>
      <h3 style={{ margin: 0 }}>Add an assignment</h3>
      <label className="lbl" htmlFor="asg-who">Who does it
        <select id="asg-who" className="in" value={assignee} onChange={(e) => setAssignee(e.target.value)} required>
          <option value="">Choose a person</option>
          {opts?.people.map((p) => <option key={p.person_id} value={p.person_id}>{p.full_name}{p.job_role ? ` · ${p.job_role}` : ""}</option>)}
        </select>
      </label>
      <ContactPicker contact={contact} suggested={suggested} onPick={setContact} label="Which contact" />
      <label className="lbl" htmlFor="asg-ins">Instruction (one sentence)
        <textarea id="asg-ins" className="in" value={instruction} maxLength={500} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Ask what else the test team needs after the January ramp-up, then book a date." required />
      </label>
      <div className="g2">
        <label className="lbl" htmlFor="asg-why">Why now (short)
          <input id="asg-why" className="in" value={why} maxLength={60} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Quote is 62 days old" />
        </label>
        <label className="lbl" htmlFor="asg-code">Expected action
          <select id="asg-code" className="in" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">Any</option>
            {SELECTABLE_ACTION_CODES.map((c) => <option key={c.code} value={c.code}>{c.code} {c.label}</option>)}
          </select>
        </label>
      </div>
      <label className="lbl" htmlFor="asg-play">Play (optional)
        <select id="asg-play" className="in" value={play} onChange={(e) => setPlay(e.target.value)}>
          <option value="">None</option>
          {opts?.plays.map((p) => <option key={p.play_id} value={p.play_id}>{p.play_id} · {p.title}</option>)}
        </select>
      </label>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn acc" type="submit" disabled={pending || !assignee || !instruction.trim()}>{pending ? "Assigning…" : "Assign"}</button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function PlanBoard({ plan }: { plan: PlanRow[] }) {
  const { toast } = useShell();
  const router = useRouter();
  const [pending, start] = useTransition();
  const drafts = plan.filter((p) => p.status === "Draft");
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card">
        {plan.length === 0 && <div className="empty">No assignments for this week yet. Add one below.</div>}
        {plan.map((p) => <PlanItem key={p.assignment_id} row={p} />)}
        {drafts.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn p" disabled={pending} onClick={() => start(async () => {
              const r = await approveAssignments(drafts.map((d) => d.assignment_id));
              if (!r.ok) toast(r.error); else { toast(`Approved ${r.data.count}.`); router.refresh(); }
            })}>Approve all remaining ({drafts.length})</button>
          </div>
        )}
      </div>
      <div><AddAssignment /></div>
    </div>
  );
}

export function Roster({ rows }: { rows: RosterRow[] }) {
  if (rows.length === 0) return <div className="empty">Nobody on your roster yet.</div>;
  return (
    <div className="card">
      {rows.map((p) => (
        <div className="roster" key={p.person_id}>
          <span>{p.full_name}{p.job_role && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.job_role}</div>}</span>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={p.target} aria-valuenow={Math.min(p.actions, p.target)} aria-label={`${p.full_name}: ${p.actions} of ${p.target}`}><i style={{ width: `${Math.min(100, (p.actions / p.target) * 100)}%` }} /></div>
          <span className="n">{p.actions} / {p.target}</span>
        </div>
      ))}
      <div className="demo" style={{ marginTop: 8 }}>Everyone on the roster is listed, including people who haven't logged anything, so participation can't look better than it is.</div>
    </div>
  );
}
