import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { requireAdmin } from "@/lib/auth/session";
import { listEmployees } from "@/lib/data/admin";
import { AdminTabs } from "./admin-tabs";
import { EmployeesClient } from "./employees-client";

export const metadata: Metadata = { title: "Admin · Employees" };

export default async function AdminEmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const people = await listEmployees();
  return (
    <Page title="Admin" wide>
      <AdminTabs current="employees" />
      <EmployeesClient people={people} initialRole={sp.role ?? ""} initialStatus={sp.status ?? ""} />
    </Page>
  );
}
