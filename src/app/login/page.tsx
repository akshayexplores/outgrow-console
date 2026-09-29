import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession, landingFor } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one below.",
  signedout: "You've been signed out.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next) ?? undefined;
  const s = await getSession();
  if (s) redirect(next ?? landingFor(s.me));
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  return (
    <main className="center-page" id="main">
      <LoginForm next={next} notice={notice} />
    </main>
  );
}
