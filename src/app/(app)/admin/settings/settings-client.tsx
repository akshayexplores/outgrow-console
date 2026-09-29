"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useShell } from "@/components/shell/shell-context";
import { saveSettings } from "../actions";

interface Props {
  adminEmail: string;
  initial: { allowed_email_domain: string; scorecard_publish_time: string; programme_start: string };
  env: { openrouter: boolean; cron: boolean; serviceRole: boolean; appUrl: boolean; budget: string; timezone: string };
}

function Status({ ok, label, fix }: { ok: boolean; label: string; fix: string }) {
  return (
    <div className="kvrow">
      <span>{label}</span>
      <span className={`chip ${ok ? "ok" : "warn"}`}>{ok ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}{ok ? "Set" : fix}</span>
    </div>
  );
}

export function SettingsClient({ adminEmail, initial, env }: Props) {
  const router = useRouter();
  const { toast } = useShell();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveSettings(v);
      if (!r.ok) { setError(r.error); return; }
      toast("Settings saved.");
      router.refresh();
    });
  };

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      <form className="card" onSubmit={submit} style={{ display: "grid", gap: 12 }} noValidate>
        <h3>Programme</h3>
        <label className="lbl">Admin email
          <input className="in" value={adminEmail} readOnly aria-readonly="true" />
          <span className="field-hint">Set by the ADMIN_EMAIL environment variable. There is exactly one admin, so it isn't editable here.</span>
        </label>
        <label className="lbl">Allowed email domain
          <input className="in" placeholder="acsiatech.com" value={v.allowed_email_domain} onChange={(e) => setV({ ...v, allowed_email_domain: e.target.value })} />
          <span className="field-hint">Optional second gate: only this domain can be added to the roster. Leave empty to allow any address the admin adds.</span>
        </label>
        <div className="grid2">
          <label className="lbl">Scorecard publish time (IST)
            <input className="in" type="time" value={v.scorecard_publish_time} onChange={(e) => setV({ ...v, scorecard_publish_time: e.target.value })} />
          </label>
          <label className="lbl">Programme start (a Monday)
            <input className="in" type="date" value={v.programme_start} onChange={(e) => setV({ ...v, programme_start: e.target.value })} />
            <span className="field-hint">Conversion rates stay hidden until week 12 counted from here.</span>
          </label>
        </div>
        <div className="kvrow"><span>Time zone</span><span>{env.timezone}, weeks start Monday</span></div>
        {error && <div className="errbox" role="alert">{error}</div>}
        <div><button className="btn acc" type="submit" disabled={pending || !dirty}>{pending ? "Saving…" : "Save settings"}</button></div>
      </form>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h3>Environment</h3>
        <p className="thin" style={{ margin: 0 }}>Keys live in Vercel's environment settings and are never shown here.</p>
        <Status ok={env.serviceRole} label="Supabase service key" fix="Add SUPABASE_SERVICE_ROLE_KEY" />
        <Status ok={env.openrouter} label="OpenRouter key (AI jobs)" fix="Add OPENROUTER_API_KEY" />
        <Status ok={env.cron} label="Cron secret (scheduled jobs)" fix="Add CRON_SECRET" />
        <Status ok={env.appUrl} label="Public app URL" fix="Add NEXT_PUBLIC_APP_URL" />
        <div className="kvrow"><span>AI monthly budget cap</span><span>${env.budget}</span></div>
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
        <h3>Sign-in checklist</h3>
        <ol className="thin" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
          <li>Supabase → Authentication → Hooks: enable <b>Before User Created</b> and pick <code>hook_before_user_created</code>.</li>
          <li>Authentication → URL Configuration: Site URL is this app's address, and add its <code>/auth/confirm</code> and <code>/auth/callback</code> addresses as redirects.</li>
          <li>Free plan email only reaches your own Supabase team. For anyone else, use <b>Copy sign-in link</b> on the Employees tab.</li>
        </ol>
      </div>
    </div>
  );
}
