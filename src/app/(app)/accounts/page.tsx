import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireNav } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requireNav("accounts");
  return (
    <Page title="Accounts">
      <ComingSoon what="Customer accounts, their people and where we could help more." milestone="M1" />
    </Page>
  );
}
