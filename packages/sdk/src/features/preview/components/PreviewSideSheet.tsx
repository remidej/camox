import * as React from "react";
import * as Sheet from "@/components/ui/sheet";
import { SHEET_WIDTH } from "../previewConstants";
import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";

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
        overlayClassName="bg-black/0" // overlay is managed on individual blocks instead
        style={{ minWidth: SHEET_WIDTH }}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        {children}
      </Sheet.SheetContent>
    </Sheet.Sheet>
  );
};

export function useIsPreviewSheetOpen() {
  const isPageContentSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isPageContentSheetOpen,
  );
  const isPeekingBlock = useSelector(
    previewStore,
    (state) => state.context.peekedBlock != null,
  );

  return isPageContentSheetOpen || isPeekingBlock;
}

export { PreviewSideSheet, Sheet as SheetParts };
