"use client";
import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/shell-context";
import { setPassword } from "./actions";

export function PasswordForm() {
  const { toast } = useShell();
  const [password, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await setPassword({ password, confirm });
      if (!r.ok) { setError(r.error); return; }
      setPw(""); setConfirm(""); toast("Password saved. You can now sign in with it.");
    });
  };

  return (
    <form className="card" onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 460 }} noValidate>
      <h3>Sign in with a password (optional)</h3>
      <p className="thin" style={{ margin: 0 }}>The emailed link always works. A password is just a shortcut.</p>
      <label className="lbl">New password<input className="in" type="password" autoComplete="new-password" value={password} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="lbl">Repeat it<input className="in" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div><button className="btn acc" type="submit" disabled={pending || !password}>{pending ? "Saving…" : "Save password"}</button></div>
    </form>
  );
}
