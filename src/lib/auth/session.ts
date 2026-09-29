import "server-only";
import { cache } from "react";
import { redirect, notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { meSchema, type Me } from "@/lib/types";
import { homeFor, navFor, type NavKey } from "@/lib/roles";

export interface Session { user: User; me: Me }

/** The signed-in user plus their roster/role context (one get_me RPC per request). Null when signed out or not on the roster. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: raw, error } = await supabase.rpc("get_me");
  if (error || !raw) return null;
  const parsed = meSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { user: data.user, me: parsed.data };
});

/** For pages: signed-in and on the roster (or the admin), otherwise redirect. */
export async function requireSession(): Promise<Session> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const s = await getSession();
  if (!s) redirect("/not-registered?reason=inactive");
  return s;
}

/** For /admin and admin actions: anyone else gets a 404 so the route isn't advertised. */
export async function requireAdmin(): Promise<Session> {
  const s = await getSession();
  if (!s || !s.me.is_admin) notFound();
  return s;
}

/** Throws (for server actions) instead of redirecting. */
export async function requireActionSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("You're signed out. Sign in again.");
  return s;
}

export function landingFor(me: Me): string {
  return homeFor({ app_role: me.app_role, is_admin: me.is_admin });
}

/** For role-gated screens: people whose nav doesn't include the screen get a 404 (RLS still decides what data they can read). */
export async function requireNav(key: NavKey): Promise<Session> {
  const s = await requireSession();
  if (!navFor({ app_role: s.me.app_role, is_admin: s.me.is_admin }).some((n) => n.key === key)) notFound();
  return s;
}
