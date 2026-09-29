"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { useShell, type PrepOpts } from "@/components/shell/shell-context";
import { getPrep } from "@/app/actions/prep";
import type { PrepData } from "@/lib/data/prep";
import { streamText } from "@/lib/stream";
import { actionLabel } from "@/lib/outgrow";

function Strength({ n }: { n: number | null }) {
  const v = Math.max(0, Math.min(5, n ?? 0));
  return <span className="strength" role="img" aria-label={n === null ? "Relationship strength unknown" : `Relationship strength ${v} of 5`}>{"●".repeat(v)}<i>{"●".repeat(5 - v)}</i></span>;
}

function More({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`acc-sec${open ? " open" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{title} <span /><i>›</i></button>
      {open && <div>{children}</div>}
    </div>
  );
}

/** The one-screen call prep: an opening line, the play's script, the pivot, and an optional three-line brief from the operator. */
export function PrepSheet({ opts, onClose }: { opts: PrepOpts; onClose: () => void }) {
  const { openLog } = useShell();
  const [prep, setPrep] = useState<PrepData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    getPrep({ contactId: opts.contactId, assignmentId: opts.assignmentId ?? null }).then((r) => {
      if (!live) return;
      if (r.ok) setPrep(r.data); else setError(r.error);
    });
    return () => { live = false; abort.current?.abort(); };
  }, [opts.contactId, opts.assignmentId]);

  async function runBrief() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBrief(""); setBriefErr(null); setBriefBusy(true);
    const r = await streamText("/api/ai/brief", { contactId: opts.contactId, assignmentId: opts.assignmentId ?? null }, setBrief, ac.signal);
    setBriefBusy(false);
    if (!r.ok && r.message) setBriefErr(r.message);
  }

  const c = prep?.contact;
  const footer = (
    <>
      <button className="btn" onClick={onClose}>Close</button><span className="sp" />
      <button className="btn p" onClick={() => openLog({ contactId: opts.contactId, assignmentId: prep?.assignment?.assignment_id ?? opts.assignmentId })}>Log this conversation</button>
    </>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Prep" footer={footer}>
      {error && <div className="errbox" role="alert">{error}</div>}
      {!prep && !error && <div className="thinking"><i />Getting ready…</div>}
      {prep && c && (
        <>
          <div>
            <h3 style={{ fontSize: 20, margin: 0 }}>{c.name}</h3>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{[c.job_title, c.account_name].filter(Boolean).join(" · ")} · <Strength n={c.strength} /></div>
            {c.days_since_touch !== null && <div className="demo">Last proactive touch {c.days_since_touch} days ago</div>}
          </div>
          {prep.warnings.map((w) => <div className="warnbox" key={w}>{w}</div>)}
          {prep.assignment && (
            <div className="op"><span className="dot"><Sparkles size={14} aria-hidden /></span>
              <div><p>{prep.assignment.instruction}</p>{prep.assignment.why_now && <div className="why">{prep.assignment.why_now}</div>}</div></div>
          )}
          <div className="script">
            <div><b>OPEN</b><p>{prep.showRapport && c.rapport ? c.rapport.split(/(?<=[.!?])\s/)[0] : `Ask how their week is going, then bring it to ${c.account_name}'s work.`}</p></div>
            {prep.play
              ? <div><b>{prep.play.play_id}{prep.assignment?.expected_action_code ? ` · ${actionLabel(prep.assignment.expected_action_code)}` : ""}</b><p>“{prep.play.script}”</p></div>
              : <div><b>ASK</b><p>“What else are you working on that we might be able to help with?”</p></div>}
            {prep.thenPlay && <div><b>{prep.thenPlay.play_id}</b><p>“{prep.thenPlay.script}”</p></div>}
            <div><b>PIVOT</b><p>End with a when: “Shall I show you on Tuesday?” Then stop talking.</p></div>
          </div>
          <div><button className="btn" onClick={runBrief} disabled={briefBusy}><Sparkles size={14} aria-hidden />Brief me</button></div>
          <div aria-live="polite">
            {briefBusy && !brief && <div className="thinking"><i />Reading the account…</div>}
            {brief && <div className="brief" style={{ whiteSpace: "pre-wrap" }}>{brief}</div>}
            {briefErr && <div className="infobox">{briefErr}</div>}
          </div>
          <More title={`More about ${c.first_name}`}>
            <div className="rows">
              <div className="rowi"><div><div className="sub">Preferred channel</div>{c.preferred_channel ?? "Not recorded"}{prep.channelRule ? <div className="sub">{prep.channelRule}</div> : null}</div></div>
              {prep.showRapport && c.interests.length > 0 && <div className="rowi"><div><div className="sub">Interests</div>{c.interests.join(" · ")}</div></div>}
              {c.priorities && <div className="rowi"><div><div className="sub">Current priorities</div>{c.priorities}</div></div>}
              {prep.insights.length > 0 && <div className="rowi"><div><div className="sub">Talking points</div>{prep.insights.map((i) => <div key={i.text}>{i.text}</div>)}</div></div>}
              {c.already_raised.length > 0 && <div className="rowi"><div><div className="sub">Already heard about</div>{c.already_raised.join(" · ")}</div></div>}
            </div>
          </More>
        </>
      )}
    </Sheet>
  );
}
