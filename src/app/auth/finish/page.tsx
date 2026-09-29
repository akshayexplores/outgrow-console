"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

function Finish() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    const fail = hash.get("error_description");
    const next = params.get("next");
    const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    if (fail) { setError(fail.replace(/\+/g, " ")); return; }
    if (!access_token || !refresh_token) { router.replace("/login?notice=link"); return; }
    createBrowserSupabase().auth.setSession({ access_token, refresh_token }).then(({ error: e }) => {
      if (e) { setError("That sign-in link has expired. Request a new one."); return; }
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(safe);
      router.refresh();
    });
  }, [params, router]);

  return (
    <div className="auth-card" role="status">
      <h1>{error ? "Sign-in didn't complete" : "Signing you in…"}</h1>
      {error ? (<><div className="errbox">{error}</div><a className="btn block" href="/login">Back to sign in</a></>) : <p>One moment.</p>}
    </div>
  );
}

export default function FinishPage() {
  return <main className="center-page"><Suspense fallback={null}><Finish /></Suspense></main>;
}
