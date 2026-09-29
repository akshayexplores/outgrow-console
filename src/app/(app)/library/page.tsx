import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell/page";
import { requireNav } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadLibrary } from "@/lib/data/library";
import { ApprovalList, PlaysTable } from "./library-client";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { me } = await requireNav("library");
  const leader = me.is_admin || me.app_role === "leader";
  const { tab: raw } = await searchParams;
  const supabase = await createClient();
  const d = await loadLibrary(supabase, leader);
  const tab = leader && raw === "approvals" ? "approvals" : "plays";
  return (
    <Page title="Library" wide>
      <div className="tabs" role="tablist" aria-label="Library views">
        <Link role="tab" aria-selected={tab === "plays"} href="/library" replace scroll={false}>Plays</Link>
        {leader && <Link role="tab" aria-selected={tab === "approvals"} href="/library?tab=approvals" replace scroll={false}>Waiting for approval ({d.approvals.length})</Link>}
      </div>
      {tab === "plays" ? <PlaysTable plays={d.plays} types={d.types} /> : <ApprovalList items={d.approvals} />}
    </Page>
  );
}
