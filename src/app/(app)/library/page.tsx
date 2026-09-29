import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireNav } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  await requireNav("library");
  return (
    <Page title="Library">
      <ComingSoon what="Plays, service lines and proof points." milestone="M1" />
    </Page>
  );
}
