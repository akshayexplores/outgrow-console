import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession, landingFor } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/next";

/**
 * PKCE return: exchanges ?code= for a session cookie and lands the person on their role home.
 * Invite emails from the admin API return tokens in the URL fragment instead, which the server can't see,
 * so with no ?code= we hand over to /auth/finish (browsers keep the fragment across the redirect).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  if (!code) {
    const finish = new URL("/auth/finish", origin);
    if (next) finish.searchParams.set("next", next);
    return NextResponse.redirect(finish);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?notice=link", origin));
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/not-registered?reason=inactive", origin));
  return NextResponse.redirect(new URL(next ?? landingFor(s.me), origin));
}
