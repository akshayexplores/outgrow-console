import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { requireAdmin } from "@/lib/auth/session";
import { getSettings } from "@/lib/data/admin";
import { AdminTabs } from "../admin-tabs";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Admin · Settings" };

export default async function SettingsPage() {
  const { me } = await requireAdmin();
  const s = await getSettings();
  const env = {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    cron: Boolean(process.env.CRON_SECRET),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    budget: process.env.AI_MONTHLY_BUDGET_USD || "150",
    timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
  };
  return (
    <Page title="Admin" wide>
      <AdminTabs current="settings" />
      <SettingsClient
        adminEmail={s.admin_email || me.email || ""}
        initial={{ allowed_email_domain: s.allowed_email_domain ?? "", scorecard_publish_time: s.scorecard_publish_time || "14:00", programme_start: s.programme_start ?? "" }}
        env={env}
      />
    </Page>
  );
}
