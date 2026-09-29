import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { requireNav } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadAccountList } from "@/lib/data/accounts";
import { AccountsTable } from "./accounts-table";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const { me } = await requireNav("accounts");
  const supabase = await createClient();
  const rows = await loadAccountList(supabase, me);
  return (
    <Page title="Accounts" wide>
      <p className="lead">Accounts where Acsia already delivers. Sorted by where a conversation is most overdue.</p>
      <AccountsTable rows={rows} showMoney={me.can_see_money} />
      {!me.can_see_money && <div className="locked" style={{ marginTop: 10 }}>Revenue and pipeline values are only shown to commercial roles and leadership.</div>}
    </Page>
  );
}
