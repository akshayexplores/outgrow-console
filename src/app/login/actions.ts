"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/env";
import { getSession, landingFor } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/next";

export interface LoginState { status: "idle" | "sent" | "error"; message?: string; email?: string }

const emailSchema = z.string().trim().toLowerCase().email("Enter your Acsia email address.");

const isGateRejection = (msg: string, status?: number) =>
  /has not been added|company email|email address is required/i.test(msg) || status === 403;

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : undefined;
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { status: "error", message: email.error.issues[0]?.message ?? "Enter a valid email." };
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const base = appUrl(await origin());
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${base}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`, shouldCreateUser: true },
  });
  if (error) {
    if (isGateRejection(error.message, error.status)) redirect(`/not-registered?email=${encodeURIComponent(email.data)}`);
    if (/rate limit|too many|seconds/i.test(error.message)) return { status: "error", message: "Too many sign-in emails just now. Wait a minute and try again.", email: email.data };
    return { status: "error", message: "We couldn't send the sign-in link. Try again, or ask the admin for a link.", email: email.data };
  }
  return { status: "sent", email: email.data };
}

export async function signInWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { status: "error", message: email.error.issues[0]?.message ?? "Enter a valid email." };
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { status: "error", message: "Enter your password (at least 8 characters).", email: email.data };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) return { status: "error", message: "That email and password don't match. Use the emailed link instead, or ask the admin.", email: email.data };
  const next = safeNext(formData.get("next"));
  const s = await getSession();
  if (!s) redirect("/not-registered?reason=inactive");
  redirect(next ?? landingFor(s.me));
}
