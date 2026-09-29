"use client";
import { Sheet } from "@/components/ui/sheet";
import type { PrepOpts } from "@/components/shell/shell-context";

export function PrepSheet({ onClose }: { opts: PrepOpts; onClose: () => void }) {
  return <Sheet open onOpenChange={(o) => !o && onClose()} title="Prep"><p>Coming in M1.</p></Sheet>;
}
