import * as React from "react";
import { useSelector } from "@xstate/store/react";
import { useMutation } from "convex/react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { previewStore } from "../previewStore";
import { usePreviewedPage } from "../CamoxPreview";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { PreviewSideSheet, SheetParts } from "./PreviewSideSheet";
import { api } from "camox/_generated/api";
import type { Block } from "@/core/createBlock";

const AddBlockSheet = () => {
  const [highlightedValue, setHighlightedValue] = React.useState<string>("");
  const createBlockMutation = useMutation(api.blocks.createBlock);
  const availableBlocks = useCamoxApp().getBlocks();
  const page = usePreviewedPage();

  const isOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSheetOpen,
  );
  const peekedBlockPosition = useSelector(
    previewStore,
    (state) => state.context.peekedBlockPosition,
  );

  const handleAddBlock = async (block: Block) => {
    if (!page) return;

    const afterPosition =
      peekedBlockPosition === ""
        ? ""
        : (peekedBlockPosition ??
          page.blocks[page.blocks.length - 1]?.position);

    const blockId = await createBlockMutation({
      pageId: page.page._id,
      type: block.id,
      content: block.getInitialContent(),
      settings: block.getInitialSettings(),
      afterPosition,
    });
    previewStore.send({ type: "focusCreatedBlock", blockId });
    previewStore.send({ type: "exitPeekedBlock" });
  };

  const handlePreviewBlock = (block: Block) => {
    const afterPosition =
      peekedBlockPosition === ""
        ? ""
        : (peekedBlockPosition ??
          page?.blocks[page.blocks.length - 1]?.position);

    previewStore.send({ type: "setPeekedBlock", block, afterPosition });
  };

  const handleValueChange = (value: string) => {
    setHighlightedValue(value);
    const block = availableBlocks.find((b: Block) => b.title === value);
    if (block) {
      handlePreviewBlock(block);
    } else {
      previewStore.send({ type: "clearPeekedBlock" });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      previewStore.send({ type: "closeAddBlockSheet" });
    }
  };

  // Reset highlighted value when sheet opens
  React.useEffect(() => {
    if (isOpen) {
      setHighlightedValue("");
    }
  }, [isOpen]);

  return (
    <PreviewSideSheet
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="flex flex-col"
    >
      <SheetParts.SheetHeader className="border-b border-border">
        <SheetParts.SheetTitle>Add new block</SheetParts.SheetTitle>
        <SheetParts.SheetDescription>
          Search and select a block to add to the page.
        </SheetParts.SheetDescription>
      </SheetParts.SheetHeader>
      <div className="flex-1 overflow-auto p-2">
        <Command
          value={highlightedValue}
          onValueChange={handleValueChange}
          className="bg-background"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              previewStore.send({ type: "closeAddBlockSheet" });
            }
          }}
        >
          <CommandInput placeholder="Search blocks..." autoFocus />
          <CommandList>
            <CommandEmpty>No blocks found.</CommandEmpty>
            <CommandGroup>
              {availableBlocks.map((block: Block) => (
                <CommandItem
                  key={block.id}
                  value={block.title}
                  onSelect={() => {
                    handleAddBlock(block);
                  }}
                  className="flex items-center gap-2"
                >
                  {block.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </PreviewSideSheet>
  );
};

export { AddBlockSheet };
