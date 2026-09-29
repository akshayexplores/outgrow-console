"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="center-page" id="main">
      <div className="auth-card" role="alert">
        <div className="brandmark"><i>O</i><div><b>Outgrow Console</b><small>Acsia · EXPAND</small></div></div>
        <h1>Something went wrong</h1>
        <p>It's on our side, not yours. Try again, and if it keeps happening tell the Outgrow admin{error.digest ? ` (reference ${error.digest})` : ""}.</p>
        <button className="btn acc block" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
