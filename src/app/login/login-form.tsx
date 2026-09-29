"use client";
import { useActionState, useState } from "react";
import { Mail, KeyRound } from "lucide-react";
import { sendMagicLink, signInWithPassword, type LoginState } from "./actions";

const initial: LoginState = { status: "idle" };

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [usePassword, setUsePassword] = useState(false);
  const [linkState, linkAction, linkPending] = useActionState(sendMagicLink, initial);
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, initial);
  const state = usePassword ? pwState : linkState;
  const pending = usePassword ? pwPending : linkPending;

  if (!usePassword && linkState.status === "sent") {
    return (
      <div className="auth-card" role="status">
        <h1>Check your inbox</h1>
        <p>We sent a sign-in link to <b>{linkState.email}</b>. Open it on this device to sign in.</p>
        <p className="thin">Nothing arrived after a minute? Check spam, or ask the Outgrow admin for a sign-in link.</p>
        <div className="linkrow"><a className="link" href="/login">Use a different email</a></div>
      </div>
    );
  }

  return (
    <form className="auth-card" action={usePassword ? pwAction : linkAction} noValidate>
      <div className="brandmark"><i>O</i><div><b>Outgrow Console</b><small>Acsia · EXPAND</small></div></div>
      <h1>Sign in</h1>
      <p>Use your Acsia email.</p>
      {notice && <div className="infobox">{notice}</div>}
      {next && <input type="hidden" name="next" value={next} />}
      <label className="lbl" htmlFor="email">Email
        <input id="email" name="email" type="email" className="in" autoComplete="email" inputMode="email" defaultValue={state.email} required autoFocus placeholder="you@acsiatech.com" />
      </label>
      {usePassword && (
        <label className="lbl" htmlFor="password">Password
          <input id="password" name="password" type="password" className="in" autoComplete="current-password" required minLength={8} />
        </label>
      )}
      {state.status === "error" && state.message && <div className="errbox" role="alert">{state.message}</div>}
      <button className="btn acc block" type="submit" disabled={pending}>
        {usePassword ? <KeyRound /> : <Mail />}
        {pending ? "Working…" : usePassword ? "Sign in" : "Email me a sign-in link"}
      </button>
      <div className="linkrow">
        <button type="button" onClick={() => setUsePassword((v) => !v)}>
          {usePassword ? "Email me a link instead" : "Use a password instead"}
        </button>
      </div>
    </form>
  );
}
