"use client";
import { useState, useTransition } from "react";
import { finishWelcome } from "./actions";

export function WelcomeClient({ name, month, questions, logs }: { name: string; month: string; questions: string[]; logs: boolean }) {
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const done = () => start(async () => { await finishWelcome(); });

  const steps = [
    {
      title: `Welcome, ${name}`,
      body: (
        <>
          <p><b>Outgrow is how we grow inside customers we already serve:</b> a few real conversations a week where we ask one good question, listen, and offer one useful thing.</p>
          <p>Small swings, taken often. Most won't land, and that's fine. What counts is that we keep swinging.</p>
        </>
      ),
    },
    {
      title: `${month}'s question`,
      body: (
        <>
          <p>When a customer conversation is already happening, try one of these:</p>
          <ul className="welcome-list">{questions.map((q) => <li key={q}>“{q}”</li>)}</ul>
          <p className="thin">Ask, then stay quiet and let them answer.</p>
        </>
      ),
    },
    {
      title: logs ? "Logging takes under a minute" : "How you'll use this",
      body: logs ? (
        <>
          <p>After a conversation, tap <b>Log a conversation</b> and type what happened, in your own words. We'll pull out the asks and offers for you to check.</p>
          <p className="thin">Only three things need your thinking: the action, the service line and the estimated value. Everything else fills itself in.</p>
        </>
      ) : (
        <>
          <p>Your home screen shows what to do next. If a customer conversation gives you something worth passing on, tell your delivery lead and they'll log it for you.</p>
          <p className="thin">Nothing you write here reaches a customer.</p>
        </>
      ),
    },
  ];
  const s = steps[step]!;
  const last = step === steps.length - 1;

  return (
    <main className="center-page" id="main">
      <div className="auth-card" role="group" aria-label={`Welcome, step ${step + 1} of ${steps.length}`}>
        <div className="brandmark"><i>O</i><div><b>Outgrow Console</b><small>Step {step + 1} of {steps.length}</small></div></div>
        <h1>{s.title}</h1>
        <div className="welcome-body">{s.body}</div>
        <div className="toolbar" style={{ margin: 0 }}>
          <button className="btn ghost" type="button" disabled={pending} onClick={done}>Skip</button>
          <span className="sp" />
          {step > 0 && <button className="btn" type="button" disabled={pending} onClick={() => setStep(step - 1)}>Back</button>}
          {last
            ? <button className="btn acc" type="button" disabled={pending} onClick={done}>{pending ? "One moment…" : "Get started"}</button>
            : <button className="btn acc" type="button" onClick={() => setStep(step + 1)}>Next</button>}
        </div>
      </div>
    </main>
  );
}
