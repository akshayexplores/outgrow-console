import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireNav } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Operator" };

export default async function OperatorPage() {
  await requireNav("operator");
  return (
    <Page title="Operator">
      <ComingSoon what="The AI operator: jobs, routes, cost and what it drafted." milestone="M2" />
    </Page>
  );
}
