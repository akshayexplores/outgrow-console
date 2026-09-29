"use client";
import { Sheet } from "@/components/ui/sheet";

export function AskSheet({ onClose }: { opts: { prompt?: string }; onClose: () => void }) {
  return <Sheet open onOpenChange={(o) => !o && onClose()} title="Ask Outgrow"><p>Coming in M1.</p></Sheet>;
}
