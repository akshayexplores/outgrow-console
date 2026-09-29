"use client";
import { createContext, useContext } from "react";
import type { Me } from "@/lib/types";
import type { NavItem } from "@/lib/roles";
import type { RefData } from "@/lib/data/ref";

export interface LogOpts { assignmentId?: string; contactId?: string; inboxId?: string; proxyPersonId?: string; text?: string }
export interface PrepOpts { contactId: string; assignmentId?: string }

export interface ShellCtx {
  me: Me;
  nav: NavItem[];
  ref: RefData;
  canLog: boolean;
  openLog: (o?: LogOpts) => void;
  openPrep: (o: PrepOpts) => void;
  openAsk: (o?: { prompt?: string }) => void;
  toast: (message: string) => void;
}

export const ShellContext = createContext<ShellCtx | null>(null);

export function useShell(): ShellCtx {
  const v = useContext(ShellContext);
  if (!v) throw new Error("useShell must be used inside <Shell>");
  return v;
}
