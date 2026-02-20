import * as React from "react";
import { useSelector } from "@xstate/store/react";
import { useMutation, useQuery } from "convex/react";
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
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const AddBlockSheet = () => {
  const [highlightedValue, setHighlightedValue] = React.useState<string>("");
  const createBlockMutation = useMutation(api.blocks.createBlock);
  const availableBlocks = useCamoxApp().getBlocks();
  const page = usePreviewedPage();
  const totalCounts = useQuery(api.blocks.getBlockUsageCounts) ?? {};

  const pageCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (!page) return counts;
    for (const block of page.blocks) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
    }
    return counts;
  }, [page]);

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
      className="flex flex-col gap-0"
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
          className="bg-background overflow-visible"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              previewStore.send({ type: "closeAddBlockSheet" });
            }
          }}
        >
          <CommandInput
            placeholder="Search blocks..."
            autoFocus
            wrapperClassName="border border-input rounded-md shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
          />
          <CommandList className="max-h-full mt-1">
            <CommandEmpty>No blocks found.</CommandEmpty>
            <CommandGroup>
              {availableBlocks
                .sort(
                  (a, b) => (totalCounts[b.id] ?? 0) - (totalCounts[a.id] ?? 0),
                )
                .map((block: Block) => (
                  <CommandItem
                    key={block.id}
                    value={block.title}
                    onSelect={() => {
                      handleAddBlock(block);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div>
                      <span>{block.title}</span>
                      <span className="text-muted-foreground block">
                        {totalCounts[block.id] ?? 0} use
                        {totalCounts[block.id] > 1 ? "s" : ""} (
                        {pageCounts[block.id] ?? "none"} here)
                      </span>
                    </div>
                    <Tooltip>
                      <TooltipTrigger>
                        <InfoIcon />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[300px]" side="right">
                        {block.description}
                      </TooltipContent>
                    </Tooltip>
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
