"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell/shell-context";
import { runJobNow, updateRoute } from "@/app/actions/operator";
import { Sheet } from "@/components/ui/sheet";
import type { RouteRow } from "@/lib/data/operator";

export function RunNow({ job, title, careful }: { job: string; title: string; careful: boolean }) {
  const { toast } = useShell();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const go = () => start(async () => {
    setConfirm(false);
    const r = await runJobNow({ job });
    toast(r.ok ? r.data.message : r.error);
    router.refresh();
  });
  if (confirm) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{job === "monday" ? "Adds drafts for people below their minimum." : "Uses AI credit."}</span>
        <button className="btn sm p" disabled={pending} onClick={go}>Run {title.toLowerCase()}</button>
        <button className="btn sm" onClick={() => setConfirm(false)}>Not now</button>
      </div>
    );
  }
  return <button className="btn sm" disabled={pending} aria-label={`Run ${title} now`} onClick={() => (careful ? setConfirm(true) : go())}>{pending ? "Running…" : "Run now"}</button>;
}

export function RouteEditor({ route }: { route: RouteRow }) {
  const { toast } = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [primary, setPrimary] = useState(route.primary_model);
  const [fallback, setFallback] = useState(route.fallback_model ?? "");
  const [temp, setTemp] = useState(String(route.temperature));
  const [tokens, setTokens] = useState(String(route.max_tokens));
  const [enabled, setEnabled] = useState(route.enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `route-${route.job}`;

  const save = () => start(async () => {
    const r = await updateRoute({ job: route.job, primary_model: primary, fallback_model: fallback, temperature: temp, max_tokens: tokens, enabled });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setOpen(false); toast("Saved."); router.refresh();
  });

  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)} aria-label={`Edit ${route.label}`}>Edit</button>
      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }} title={route.label}
        footer={<><span className="sp" /><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn p" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button></>}>
        <label className="lbl" htmlFor={`${id}-p`}>Model
          <input id={`${id}-p`} className="in" value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="vendor/model-name" />
        </label>
        <label className="lbl" htmlFor={`${id}-f`}>Backup model (optional)
          <input id={`${id}-f`} className="in" value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="vendor/model-name" />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="lbl" htmlFor={`${id}-t`}>Temperature (0 to 1)
            <input id={`${id}-t`} className="in" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} />
          </label>
          <label className="lbl" htmlFor={`${id}-m`}>Max tokens
            <input id={`${id}-m`} className="in" inputMode="numeric" value={tokens} onChange={(e) => setTokens(e.target.value)} />
          </label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Job is on</label>
        <div className="demo">Check the model name at openrouter.ai/models. A wrong name makes the job use its backup, then the plain form.</div>
        {error && <div className="errbox" role="alert">{error}</div>}
      </Sheet>
    </>
  );
}
