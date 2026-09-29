import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSession, landingFor } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/next";

const TYPES: EmailOtpType[] = ["magiclink", "email", "invite", "recovery", "signup", "email_change"];

/**
 * Token-hash sign-in. Works in any browser (no PKCE verifier cookie needed), so it's what the branded email templates
 * and the admin's "Copy sign-in link" button use: /auth/confirm?token_hash=...&type=magiclink
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));
  if (!tokenHash || !type || !TYPES.includes(type)) return NextResponse.redirect(new URL("/login?notice=link", origin));
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(new URL("/login?notice=link", origin));
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/not-registered?reason=inactive", origin));
  return NextResponse.redirect(new URL(next ?? landingFor(s.me), origin));
}
