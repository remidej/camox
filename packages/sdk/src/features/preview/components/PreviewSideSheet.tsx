import * as React from "react";
import * as Sheet from "@/components/ui/sheet";
import { SHEET_WIDTH } from "../previewConstants";

interface PreviewSideSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAutoFocus?: (e: Event) => void;
  children: React.ReactNode;
  className?: string;
}

const PreviewSideSheet = ({
  open,
  onOpenChange,
  onOpenAutoFocus,
  children,
  className,
}: PreviewSideSheetProps) => {
  return (
    <Sheet.Sheet open={open} onOpenChange={onOpenChange}>
      <Sheet.SheetContent
        className={className}
        side="left"
        overlayClassName="bg-black/0"
        style={{ minWidth: SHEET_WIDTH }}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        {children}
      </Sheet.SheetContent>
    </Sheet.Sheet>
  );
};

export {
  PreviewSideSheet,
  Sheet as SheetParts,
};
