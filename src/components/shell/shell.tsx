"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { BarChart3, Briefcase, BookOpen, ListChecks, Plus, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { Me } from "@/lib/types";
import type { NavItem, NavKey } from "@/lib/roles";
import type { RefData } from "@/lib/data/ref";
import { ShellContext, type LogOpts, type PrepOpts, type ShellCtx } from "./shell-context";

const LogSheet = dynamic(() => import("@/components/sheets/log-sheet").then((m) => m.LogSheet), { ssr: false });
const PrepSheet = dynamic(() => import("@/components/sheets/prep-sheet").then((m) => m.PrepSheet), { ssr: false });
const AskSheet = dynamic(() => import("@/components/sheets/ask-sheet").then((m) => m.AskSheet), { ssr: false });

const ICONS: Record<NavKey, React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  today: ListChecks, accounts: Briefcase, team: Users, scorecard: BarChart3, library: BookOpen, operator: Sparkles, admin: ShieldCheck,
};

type SheetState =
  | { kind: "log"; opts: LogOpts; key: number }
  | { kind: "prep"; opts: PrepOpts; key: number }
  | { kind: "ask"; opts: { prompt?: string }; key: number }
  | null;

export function Shell({ me, nav, refData, canLog, badges, children }: {
  me: Me; nav: NavItem[]; refData: RefData; canLog: boolean; badges: Partial<Record<NavKey, number>>; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    window.setTimeout(() => setToastMsg((m) => (m === message ? null : m)), 3200);
  }, []);
  const close = useCallback(() => setSheet(null), []);

  const ctx: ShellCtx = useMemo(() => ({
    me, nav, ref: refData, canLog,
    openLog: (opts = {}) => setSheet({ kind: "log", opts, key: Date.now() }),
    openPrep: (opts) => setSheet({ kind: "prep", opts, key: Date.now() }),
    openAsk: (opts = {}) => setSheet({ kind: "ask", opts, key: Date.now() }),
    toast,
  }), [me, nav, refData, canLog, toast]);

  return (
    <ShellContext.Provider value={ctx}>
      <div className="app">
        <nav className="rail" aria-label="Main">
          <div className="brand"><i>O</i><div><b>Outgrow</b><small>Acsia · EXPAND</small></div></div>
          {nav.map((n) => {
            const Icon = ICONS[n.key];
            const current = pathname === n.href || pathname.startsWith(n.href + "/");
            const badge = badges[n.key];
            return (
              <Link key={n.key} href={n.href} className="nav" aria-current={current ? "page" : undefined} prefetch>
                <Icon size={18} aria-hidden />
                <span>{n.label}</span>
                {badge ? <span className="badge" aria-label={`${badge} waiting`}>{badge}</span> : null}
              </Link>
            );
          })}
          <div className="spacer" />
          <div className="foot">Outgrow Console</div>
        </nav>
        <div className="main">{children}</div>
        {canLog && (
          <button className="fab" onClick={() => ctx.openLog()} aria-label="Log a conversation">
            <Plus aria-hidden />Log a conversation
          </button>
        )}
      </div>
      {sheet?.kind === "log" && <LogSheet key={sheet.key} opts={sheet.opts} onClose={close} />}
      {sheet?.kind === "prep" && <PrepSheet key={sheet.key} opts={sheet.opts} onClose={close} />}
      {sheet?.kind === "ask" && <AskSheet key={sheet.key} opts={sheet.opts} onClose={close} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </ShellContext.Provider>
  );
}
