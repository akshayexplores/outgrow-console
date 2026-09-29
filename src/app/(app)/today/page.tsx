import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireNav } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  await requireNav("today");
  return (
    <Page title="Today">
      <ComingSoon what="Your next conversations, this week's progress and what to do first." milestone="M1" />
    </Page>
  );
}
