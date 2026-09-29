"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** Right-hand side sheet (full screen on phones). Radix Dialog gives focus trapping, Escape and aria roles. */
export function Sheet({ open, onOpenChange, title, header, footer, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="sheet sheet-anim" aria-describedby={undefined}>
          <div className="sheet-h">
            <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
            {header}
            <Dialog.Close className="x" aria-label="Close"><X size={18} /></Dialog.Close>
          </div>
          <div className="sheet-b">{children}</div>
          {footer ? <div className="sheet-f">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
