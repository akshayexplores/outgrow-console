"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchContacts } from "@/app/actions/log";
import type { ContactLite } from "@/lib/log";

/** Contact chips (assigned and recent), a name/account search, and the current choice. Used on both steps. */
export function ContactPicker({ contact, suggested, onPick, label = "Who did you speak to?" }: { contact: ContactLite | null; suggested: ContactLite[]; onPick: (c: ContactLite | null) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ContactLite[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const mine = ++seq.current;
    setBusy(true);
    const t = window.setTimeout(async () => {
      const r = await searchContacts(term);
      if (mine === seq.current) { setResults(r.ok ? r.data : []); setBusy(false); }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const chips = suggested.filter((c) => c.contact_id !== contact?.contact_id).slice(0, 6);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="lbl">{label}</div>
      {contact ? (
        <div className="chips">
          <span className="chip a">{contact.name} · {contact.account_name}</span>
          <button type="button" className="btn sm" onClick={() => onPick(null)}>Change</button>
        </div>
      ) : (
        <>
          {chips.length > 0 && (
            <div className="chips" role="group" aria-label="Suggested contacts">
              {chips.map((c) => <button key={c.contact_id} type="button" className="chip" onClick={() => onPick(c)}>{c.name} · {c.account_name}</button>)}
            </div>
          )}
          <label className="lbl" htmlFor="contact-search">
            Find a contact or account
            <span style={{ position: "relative", display: "block" }}>
              <Search size={14} aria-hidden style={{ position: "absolute", left: 10, top: 12, color: "var(--muted)" }} />
              <input id="contact-search" className="in" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least two letters" autoComplete="off" />
            </span>
          </label>
          {busy && <div className="thinking"><i />Searching…</div>}
          {!busy && q.trim().length >= 2 && results.length === 0 && <div className="demo">No contact matches “{q.trim()}”. Contacts are added by the admin or imported.</div>}
          {results.length > 0 && (
            <div className="rows" role="listbox" aria-label="Search results">
              {results.map((c) => (
                <button key={c.contact_id} type="button" role="option" aria-selected={false} className="rowi" style={{ textAlign: "left", width: "100%", cursor: "pointer" }} onClick={() => { onPick(c); setQ(""); }}>
                  <div><b>{c.name}</b>{c.job_title ? <> · {c.job_title}</> : null}<div className="sub">{c.account_name}</div></div>
                  {c.contact_status === "Do not contact" && <span className="chip warn">Do not contact</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

