import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";
import { PreviewSideSheet, SheetParts } from "./PreviewSideSheet";

const AgentChatSheet = () => {
  const isOpen = useSelector(
    previewStore,
    (state) => state.context.isAgentChatSheetOpen,
  );

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      previewStore.send({ type: "closeAgentChatSheet" });
    }
  };

  return (
    <PreviewSideSheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetParts.SheetHeader>
        <SheetParts.SheetTitle>Agent Chat</SheetParts.SheetTitle>
        <SheetParts.SheetDescription>
          Describe the changes you'd like to make to this page.
        </SheetParts.SheetDescription>
      </SheetParts.SheetHeader>
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-muted-foreground text-sm text-center">
          Coming soon
        </p>
      </div>
    </PreviewSideSheet>
  );
};

export { AgentChatSheet };
