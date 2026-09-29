import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/roles";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const { me } = await requireSession();
  let manager: string | null = null;
  if (me.manager_id) {
    const supabase = await createClient();
    const { data } = await supabase.from("acsia_people").select("full_name").eq("person_id", me.manager_id).maybeSingle();
    manager = data?.full_name ?? null;
  }
  return (
    <Page title="Your account">
      <div className="card" style={{ display: "grid", gap: 6, marginBottom: 16 }}>
        <h3>{me.full_name}</h3>
        <div className="kvrow"><span>Email</span><span>{me.email}</span></div>
        <div className="kvrow"><span>Role</span><span>{me.app_role ? ROLE_LABEL[me.app_role] : "Admin"}{me.is_admin ? " · Admin" : ""}</span></div>
        {manager && <div className="kvrow"><span>Manager</span><span>{manager}</span></div>}
        {me.on_roster && <div className="kvrow"><span>Weekly target</span><span>{me.weekly_target}</span></div>}
        <p className="thin" style={{ margin: "6px 0 0" }}>Role, manager and target are set by the Outgrow admin.</p>
      </div>
      <PasswordForm />
      <form action="/auth/signout" method="post" style={{ marginTop: 16 }}><button className="btn" type="submit">Sign out</button></form>
    </Page>
  );
}
