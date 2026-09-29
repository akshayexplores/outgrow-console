import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Not registered" };

export default async function NotRegistered({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = typeof sp.email === "string" ? sp.email : data.user?.email;
  const inactive = sp.reason === "inactive";
  return (
    <main className="center-page" id="main">
      <div className="auth-card">
        <div className="brandmark"><i>O</i><div><b>Outgrow Console</b><small>Acsia · EXPAND</small></div></div>
        <h1>{inactive ? "Your access is switched off" : "Your email hasn't been added yet"}</h1>
        <p>
          {inactive
            ? "Your account isn't active on the Outgrow roster."
            : email ? <>We couldn't find <b>{email}</b> on the Outgrow roster.</> : "We couldn't find your email on the Outgrow roster."}
          {" "}Ask the Outgrow admin to add you, then sign in again.
        </p>
        {data.user ? (
          <form action="/auth/signout" method="post"><button className="btn block" type="submit">Sign out</button></form>
        ) : (
          <a className="btn block" href="/login">Back to sign in</a>
        )}
      </div>
    </main>
  );
}
