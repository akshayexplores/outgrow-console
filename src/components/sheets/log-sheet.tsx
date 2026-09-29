"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { useShell, type LogOpts } from "@/components/shell/shell-context";
import { loadContactChoices, loadPerson, parseCapture, saveLog, type SaveResult } from "@/app/actions/log";
import { ContactPicker } from "@/components/contact-picker";
import { buildLogPayload, checkDraft, draftActionCount, emptyDraft, hasErrors, newAskKey, type ContactLite, type LogDraft } from "@/lib/log";
import { CHANNELS, SELECTABLE_ACTION_CODES, TOUCH_TYPES, isProactive } from "@/lib/outgrow";
import { todayIST, addDays } from "@/lib/dates";
import { plural } from "@/lib/format";

type Step = "capture" | "check" | "saved";
const STEPS: { key: Step; label: string }[] = [{ key: "capture", label: "What happened" }, { key: "check", label: "Check" }, { key: "saved", label: "Saved" }];

export function LogSheet({ opts, onClose }: { opts: LogOpts; onClose: () => void }) {
  const { ref } = useShell();
  const router = useRouter();
  const today = useMemo(() => todayIST(), []);
  const [step, setStep] = useState<Step>("capture");
  const [draft, setDraft] = useState<LogDraft>(() => ({
    ...emptyDraft(today), assignmentId: opts.assignmentId ?? null, inboxId: opts.inboxId ?? null, personId: opts.proxyPersonId ?? null, contactId: opts.contactId ?? null, rawText: opts.text ?? "",
  }));
  const [text, setText] = useState(opts.text ?? "");
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [suggested, setSuggested] = useState<ContactLite[]>([]);
  const [proxyName, setProxyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [parsing, startParse] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      const [choices, person] = await Promise.all([
        loadContactChoices({ contactId: opts.contactId ?? null, personId: opts.proxyPersonId ?? null }),
        opts.proxyPersonId ? loadPerson(opts.proxyPersonId) : Promise.resolve(null),
      ]);
      if (!live) return;
      if (choices.ok) {
        setSuggested(choices.data.suggested);
        if (opts.contactId) {
          const c = choices.data.suggested.find((x) => x.contact_id === opts.contactId) ?? null;
          if (c) pick(c);
        }
      }
      if (person?.ok && person.data) setProxyName(person.data.full_name);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(c: ContactLite | null) {
    setContact(c);
    setDraft((d) => ({ ...d, contactId: c?.contact_id ?? null, accountId: c?.account_id ?? null }));
  }

  const lineById = useMemo(() => new Map(ref.serviceLines.map((l) => [l.service_line_id, l])), [ref.serviceLines]);
  const shortOf = (id: string) => lineById.get(id)?.short_code ?? "";
  const noneLine = ref.serviceLines.find((l) => l.short_code === "NONE");
  const rules = ref.channelRules;
  const issues = useMemo(() => checkDraft(draft, contact, rules, shortOf, ref.doNotOffer), [draft, contact, rules, ref.doNotOffer]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocked = hasErrors(issues);
  const n = draftActionCount(draft);
  const proxyLabel = proxyName ?? "them";

  function runParse() {
    setError(null);
    startParse(async () => {
      const r = await parseCapture({ text, contactId: contact?.contact_id ?? null, personId: opts.proxyPersonId ?? null });
      if (!r.ok) { setError(r.error); return; }
      const p = r.data;
      const chosen = contact ?? p.contact;
      setContact(chosen);
      setNotice(p.notice);
      setDraft((d) => ({
        ...d, contactId: chosen?.contact_id ?? null, accountId: chosen?.account_id ?? null, touchType: p.touchType, channel: p.channel,
        followUpDate: p.followUpDate, note: p.note, rawText: text, aiRunIds: p.aiRunIds, aiParsed: p.usedAi, follow: p.follow,
        asks: p.asks.map((a) => ({ ...a, key: newAskKey() })),
      }));
      setStep("check");
    });
  }

  function manual() {
    setNotice(null);
    setDraft((d) => ({ ...d, rawText: text }));
    setStep("check");
  }

  function save() {
    setError(null);
    startSave(async () => {
      const r = await saveLog(buildLogPayload(draft));
      if (!r.ok) { setError(r.error); return; }
      setSaved(r.data);
      setStep("saved");
      router.refresh();
    });
  }

  const setAsk = (key: string, patch: Partial<LogDraft["asks"][number]>) => setDraft((d) => ({ ...d, asks: d.asks.map((a) => (a.key === key ? { ...a, ...patch } : a)) }));
  const removeAsk = (key: string) => setDraft((d) => ({ ...d, asks: d.asks.filter((a) => a.key !== key), follow: [] }));
  const addAsk = () => setDraft((d) => ({ ...d, asks: [...d.asks, { key: newAskKey(), code: "OG1.2", service_line_id: noneLine?.service_line_id ?? "", value_usd: "0", said: "" }] }));

  const header = (
    <div className="stepper" style={{ marginLeft: 12 }} aria-label="Progress">
      {STEPS.map((s) => <span key={s.key} className={s.key === step ? "on" : ""} aria-current={s.key === step ? "step" : undefined}>{s.label}</span>)}
    </div>
  );
  const proxyBanner = opts.proxyPersonId ? <div className="warnbox" style={{ background: "var(--info-t)", color: "var(--info)" }}>Logging on behalf of {proxyLabel}. They get the credit.</div> : null;

  /* ---------------------------------------------------------------- step 1 */
  if (step === "capture") {
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()} title="Log a conversation" header={header}
        footer={<>
          <button className="btn" onClick={manual}>Fill the form instead</button><span className="sp" />
          {parsing ? <span className="thinking"><i />Reading…</span> : <button className="btn p" onClick={runParse} disabled={text.trim().length < 3}>Turn into a log</button>}
        </>}>
        {proxyBanner}
        <label className="lbl" htmlFor="capture-text">
          Say what happened, in your own words
          <textarea id="capture-text" className="in" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
            placeholder="e.g. Mentioned LiLA to Dana at the sync. She said the DC-DC FuSa test is with another supplier. Walkthrough Tuesday." />
        </label>
        <ContactPicker contact={contact} suggested={suggested} onPick={pick} />
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>The operator turns this into a log with its action codes. You check it before it's saved.</div>
        {error && <div className="errbox" role="alert">{error}</div>}
      </Sheet>
    );
  }

  /* ---------------------------------------------------------------- step 3 */
  if (step === "saved" && saved) {
    const c = saved.created;
    const rows = [
      `1 conversation${contact ? ` with ${contact.name}` : ""}`,
      `${plural(saved.actionsWritten, "action")} written`,
      c.insights ? `${plural(c.insights, "insight")}` : "", c.whitespace ? `${plural(c.whitespace, "whitespace update")}` : "",
      c.opportunities ? `${plural(c.opportunities, "opportunity", "opportunities")} (stage Identified)` : "", c.referrals ? `${plural(c.referrals, "referral")}` : "",
      c.share_readings ? "1 share-of-wallet reading" : "", c.stories ? "Nominated as a story for Friday" : "",
    ].filter(Boolean);
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()} title="Log a conversation" header={header}
        footer={<><span className="sp" /><button className="btn p" onClick={onClose}>Done</button></>}>
        <div className="okbox" role="status">Saved. {plural(saved.actionsWritten, "action")} {opts.proxyPersonId ? `for ${proxyLabel}` : "for you"}, now at {saved.week.actions} this week.</div>
        <div className="rows">{rows.map((r) => <div className="rowi" key={r}><div>{r}</div><span className="chip ok">saved</span></div>)}</div>
        {saved.week.just_reached && <p style={{ margin: 0 }}>That's the weekly target. {opts.proxyPersonId ? proxyLabel : "You'll"} be counted as participating on Friday.</p>}
        {saved.warnings.map((w) => <div className="warnbox" key={w}>{w}</div>)}
      </Sheet>
    );
  }

  /* ---------------------------------------------------------------- step 2 */
  const proactive = isProactive(draft.touchType);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Log a conversation" header={header}
      footer={<>
        <button className="btn" onClick={() => { setStep("capture"); setError(null); }}>← Back</button><span className="sp" />
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{plural(n, "action")}</span>
        <button className="btn acc" onClick={save} disabled={saving || blocked || n === 0}>{saving ? "Saving…" : "Save"}</button>
      </>}>
      {proxyBanner}
      {notice && <div className="infobox" role="status">{notice}</div>}
      <ContactPicker contact={contact} suggested={suggested} onPick={pick} />
      <div className="g2">
        <label className="lbl" htmlFor="log-type">Conversation
          <select id="log-type" className="in" value={draft.touchType} onChange={(e) => setDraft((d) => ({ ...d, touchType: e.target.value }))}>
            {TOUCH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="lbl" htmlFor="log-channel">Channel
          <select id="log-channel" className="in" value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value }))}>
            {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            <option disabled>Email: not an action channel</option>
          </select>
        </label>
      </div>
      <div className="g2">
        <label className="lbl" htmlFor="log-date">Date
          <input id="log-date" className="in" type="date" value={draft.touchDate} min={addDays(today, -30)} max={today} onChange={(e) => setDraft((d) => ({ ...d, touchDate: e.target.value }))} />
        </label>
        <label className="lbl" htmlFor="log-follow">Follow up on
          <input id="log-follow" className="in" type="date" value={draft.followUpDate} min={addDays(today, 1)} onChange={(e) => setDraft((d) => ({ ...d, followUpDate: e.target.value }))} />
        </label>
      </div>
      <div className="chips">
        {proactive ? <span className="chip ok">{draft.touchType === "Handwritten note" ? "Personal note · counts as an action" : "Proactive · counts as a call (OG0.1)"}</span> : <span className="chip warn">Not proactive · the asks still count</span>}
        {opts.proxyPersonId && <span className="chip info">Credit: {proxyLabel}</span>}
      </div>

      <div aria-live="polite" style={{ display: "grid", gap: 6 }}>
        {issues.filter((i) => i.level === "warn").map((i, k) => <div className="warnbox" key={`w${k}`}>{i.message}</div>)}
        {issues.filter((i) => i.level === "error").map((i, k) => <div className="errbox" key={`e${k}`}>{i.message}</div>)}
      </div>

      <div className="lbl">The asks · what you asked, about which service, and roughly how much</div>
      {draft.asks.map((a, i) => (
        <div className="arow" key={a.key}>
          <label className="lbl" htmlFor={`ask-code-${a.key}`}>Action
            <select id={`ask-code-${a.key}`} className="in" value={a.code} onChange={(e) => setAsk(a.key, { code: e.target.value })}>
              {SELECTABLE_ACTION_CODES.map((o) => <option key={o.code} value={o.code}>{o.code} {o.label}</option>)}
            </select>
          </label>
          <label className="lbl" htmlFor={`ask-line-${a.key}`}>Service line
            <select id={`ask-line-${a.key}`} className="in" value={a.service_line_id} onChange={(e) => setAsk(a.key, { service_line_id: e.target.value })}>
              {ref.serviceLines.map((l) => <option key={l.service_line_id} value={l.service_line_id}>{l.name}</option>)}
            </select>
          </label>
          <label className="lbl" htmlFor={`ask-val-${a.key}`}>Value (USD)
            <input id={`ask-val-${a.key}`} className="in" inputMode="numeric" value={a.value_usd} onChange={(e) => setAsk(a.key, { value_usd: e.target.value.replace(/[^0-9.]/g, "") })} />
          </label>
          <button type="button" className="rm" onClick={() => removeAsk(a.key)} aria-label={`Remove ask ${i + 1}`}><X size={14} aria-hidden /></button>
          <label className="lbl said" htmlFor={`ask-said-${a.key}`}>What they said (optional)
            <input id={`ask-said-${a.key}`} className="in" value={a.said} maxLength={600} onChange={(e) => setAsk(a.key, { said: e.target.value })} />
          </label>
        </div>
      ))}
      <button type="button" className="btn sm" style={{ justifySelf: "start" }} onClick={addAsk} disabled={draft.asks.length >= 12}>+ Another ask</button>

      {draft.follow.length > 0 && (
        <>
          <div className="lbl">{draft.aiParsed ? "The operator also suggests. Tick what's right" : "Suggestions from your note. Tick what's right"}</div>
          <div className="follow">
            {draft.follow.map((f) => (
              <label key={f.id}>
                <input type="checkbox" checked={f.on} onChange={(e) => setDraft((d) => ({ ...d, follow: d.follow.map((x) => (x.id === f.id ? { ...x, on: e.target.checked } : x)) }))} />
                <span><b>{{ insight: "Insight", whitespace: "Whitespace", opportunity: "Opportunity", referral: "Referral", share_reading: "Share of wallet" }[f.kind]}</b>{f.text}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <label className="lbl" htmlFor="log-note">One-line note (optional)
        <input id="log-note" className="in" value={draft.note} maxLength={1000} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
      </label>
      <label className="check-row" htmlFor="log-nominate" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input id="log-nominate" type="checkbox" checked={draft.nominate} onChange={(e) => setDraft((d) => ({ ...d, nominate: e.target.checked }))} style={{ accentColor: "var(--accent)" }} />
        Nominate this as a story for Friday's scorecard
      </label>
      {error && <div className="errbox" role="alert">{error}</div>}
    </Sheet>
  );
}
