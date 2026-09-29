import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { canLog, navFor } from "@/lib/roles";
import { getRefData } from "@/lib/data/ref";
import { Shell } from "@/components/shell/shell";
import { createClient } from "@/lib/supabase/server";
import { loadBadges, loadNotifications } from "@/lib/data/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { me } = await requireSession();
  // First sign-in: the 3-step welcome shows once (skippable). The admin, who may not be on the roster, skips it.
  if (me.on_roster && !me.welcomed_at) redirect("/welcome");
  const view = { app_role: me.app_role, is_admin: me.is_admin };
  const supabase = await createClient();
  const [refData, badges, notifications] = await Promise.all([getRefData(), loadBadges(supabase, me), loadNotifications(supabase, me)]);
  return (
    <Shell me={me} nav={navFor(view)} refData={refData} canLog={canLog(view)} badges={badges} notifications={notifications}>
      {children}
    </Shell>
  );
}
