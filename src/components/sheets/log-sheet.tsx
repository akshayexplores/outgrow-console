"use client";
import { Sheet } from "@/components/ui/sheet";
import type { LogOpts } from "@/components/shell/shell-context";

export function LogSheet({ onClose }: { opts: LogOpts; onClose: () => void }) {
  return <Sheet open onOpenChange={(o) => !o && onClose()} title="Log a conversation"><p>Coming in M1.</p></Sheet>;
}
