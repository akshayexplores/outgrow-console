"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export function Modal({ open, onOpenChange, title, footer, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; footer?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal" aria-describedby={undefined}>
          <div className="sheet-h"><Dialog.Title asChild><h2>{title}</h2></Dialog.Title><Dialog.Close className="x" aria-label="Close"><X size={18} /></Dialog.Close></div>
          <div className="sheet-b">{children}</div>
          {footer ? <div className="sheet-f">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
