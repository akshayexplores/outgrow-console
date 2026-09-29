import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireNav } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Scorecard" };

export default async function ScorecardPage() {
  await requireNav("scorecard");
  return (
    <Page title="Scorecard">
      <ComingSoon what="The weekly scorecard: participation, conversations and what we learned." milestone="M1" />
    </Page>
  );
}
