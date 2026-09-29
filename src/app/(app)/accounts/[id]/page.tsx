import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireNav } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountDetailPage() {
  await requireNav("accounts");
  return (
    <Page title="Account" back={{ href: "/accounts", label: "Accounts" }}>
      <ComingSoon what="Everything about one customer: people, history, whitespace and the next best conversation." milestone="M1" />
    </Page>
  );
}
