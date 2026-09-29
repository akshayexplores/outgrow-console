import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireNav } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  await requireNav("team");
  return (
    <Page title="Team">
      <ComingSoon what="This week's plan for your team: approve, drop or edit the suggested assignments." milestone="M1" />
    </Page>
  );
}
