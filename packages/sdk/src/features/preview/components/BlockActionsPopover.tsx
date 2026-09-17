import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@camox/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { Copy, Pen, Settings, Trash2 } from "lucide-react";
import * as React from "react";

import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { type NormalizedBlock, usePageBlocks } from "@/lib/normalized-data";
import { blockMutations, repeatableItemMutations } from "@/lib/queries";
import { formatShortcut } from "@/lib/utils";

import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { usePreviewedPage } from "../CamoxPreview";
import { previewStore, selectionItemId } from "../previewStore";
import { useUpdateBlockPosition } from "./useUpdateBlockPosition";

interface BlockActionsPopoverProps {
  block: NormalizedBlock | undefined | null;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLayoutBlock?: boolean;
  layoutPlacement?: "before" | "after";
}

const BlockActionsPopover = ({
  block,
  children,
  open,
  onOpenChange,
  align = "start",
  isLayoutBlock,
  layoutPlacement,
}: BlockActionsPopoverProps) => {
  const [blockToDelete, setBlockToDelete] = React.useState<NormalizedBlock | null>(null);

  const camoxApp = useCamoxApp();
  const page = usePreviewedPage();
  const { pageBlocks } = usePageBlocks(page);

  const deleteBlock = useMutation(blockMutations.delete());
  const duplicateBlock = useMutation(blockMutations.duplicate());
  const deleteManyBlocks = useMutation(blockMutations.deleteMany());

  const handleDeleteBlock = async (block: NormalizedBlock) => {
    try {
      await deleteBlock.mutateAsync({ id: block.id });
      toast.success(`Deleted "${block.summary || block.type}" block`);
    } catch (error) {
      console.error("Failed to delete block:", error);
      toast.error("Could not delete block");
    } finally {
      setBlockToDelete(null);
    }
  };

  const handleDuplicateBlock = async (block: NormalizedBlock) => {
    try {
      await duplicateBlock.mutateAsync({ id: block.id });
      toast.success(`Duplicated "${block.summary}" block`);
    } catch (error) {
      console.error("Failed to duplicate block:", error);
      toast.error("Could not duplicate block");
    }
  };

  const handleAddBlockAbove = (block: NormalizedBlock) => {
    if (!page) return;

    const blockIndex = pageBlocks.findIndex((b) => b.id === block.id);
    const afterPosition = blockIndex > 0 ? pageBlocks[blockIndex - 1].position : "";

    previewStore.send({
      type: "openAddBlockSidebar",
      afterPosition,
    });
  };

  const handleAddBlockBelow = (block: NormalizedBlock) => {
    previewStore.send({
      type: "openAddBlockSidebar",
      afterPosition: block.position,
    });
  };

  const getBlocksAbove = (block: NormalizedBlock) => {
    if (!page) return [];
    const blockIndex = pageBlocks.findIndex((b) => b.id === block.id);
    return pageBlocks.slice(0, blockIndex);
  };

  const getBlocksBelow = (block: NormalizedBlock) => {
    if (!page) return [];
    const blockIndex = pageBlocks.findIndex((b) => b.id === block.id);
    return pageBlocks.slice(blockIndex + 1);
  };

  const handleDeleteBlocksAbove = async (block: NormalizedBlock) => {
    const blocksAbove = getBlocksAbove(block);
    if (blocksAbove.length === 0) return;

    try {
      await deleteManyBlocks.mutateAsync({ blockIds: blocksAbove.map((b) => b.id) });
      toast.success(`Deleted ${blocksAbove.length} block${blocksAbove.length === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("Failed to delete blocks above:", error);
      toast.error("Could not delete blocks");
    }
  };

  const handleDeleteBlocksBelow = async (block: NormalizedBlock) => {
    const blocksBelow = getBlocksBelow(block);
    if (blocksBelow.length === 0) return;

    try {
      await deleteManyBlocks.mutateAsync({ blockIds: blocksBelow.map((b) => b.id) });
      toast.success(`Deleted ${blocksBelow.length} block${blocksBelow.length === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("Failed to delete blocks below:", error);
      toast.error("Could not delete blocks");
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger render={children as React.ReactElement} />
        {block && (
          <PopoverContent className="w-75 p-0" align={align}>
            <Command>
              <CommandInput placeholder="Search actions..." />
              <CommandList className="max-h-[350px]">
                <CommandGroup>
                  <CommandItem
                    className="justify-between"
                    onSelect={() => {
                      previewStore.send({
                        type: "openBlockContentSheet",
                        blockId: block.id,
                      });
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Pen className="h-4 w-4" />
                      Edit in form
                    </div>
                    <CommandShortcut>
                      {formatShortcut({ key: "j", withMeta: true })}
                    </CommandShortcut>
                  </CommandItem>
                  {!isLayoutBlock &&
                    (() => {
                      const blockDef = camoxApp.getBlockById(block.type);
                      const hasSettings =
                        blockDef?._internal.settingsSchema?.properties &&
                        Object.keys(blockDef._internal.settingsSchema.properties).length > 0;
                      if (!hasSettings) return null;
                      return (
                        <CommandItem
                          className="justify-between"
                          onSelect={() => {
                            previewStore.send({
                              type: "openBlockContentSheet",
                              blockId: block.id,
                            });
                            onOpenChange(false);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Settings className="h-4 w-4" />
                            Open settings
                          </div>
                        </CommandItem>
                      );
                    })()}
                </CommandGroup>
                {isLayoutBlock && layoutPlacement === "before" && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => {
                          previewStore.send({
                            type: "openAddBlockSidebar",
                            afterPosition: "",
                          });
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-4" />
                          Add block below
                        </div>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
                {isLayoutBlock && layoutPlacement === "after" && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => {
                          const lastPageBlock = pageBlocks[pageBlocks.length - 1];
                          previewStore.send({
                            type: "openAddBlockSidebar",
                            afterPosition: lastPageBlock?.position,
                          });
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-4" />
                          Add block above
                        </div>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
                {!isLayoutBlock && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        className="justify-between"
                        onSelect={() => {
                          handleAddBlockBelow(block);
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-4" />
                          Add block below
                        </div>
                        <CommandShortcut>{formatShortcut({ key: "o" })}</CommandShortcut>
                      </CommandItem>
                      <CommandItem
                        className="justify-between"
                        onSelect={() => {
                          handleAddBlockAbove(block);
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-4" />
                          Add block above
                        </div>
                        <CommandShortcut>
                          {formatShortcut({ key: "o", withShift: true })}
                        </CommandShortcut>
                      </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        className="justify-between"
                        onSelect={() => {
                          void handleDuplicateBlock(block);
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Copy className="h-4 w-4" />
                          Duplicate block
                        </div>
                        <CommandShortcut>
                          {formatShortcut({ key: "d", withMeta: true })}
                        </CommandShortcut>
                      </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => {
                          void handleDeleteBlocksAbove(block);
                          onOpenChange(false);
                        }}
                        disabled={getBlocksAbove(block).length === 0}
                      >
                        <span className="w-4" />
                        Delete blocks above
                      </CommandItem>
                      <CommandItem
                        onSelect={() => {
                          void handleDeleteBlocksBelow(block);
                          onOpenChange(false);
                        }}
                        disabled={getBlocksBelow(block).length === 0}
                      >
                        <span className="w-4" />
                        Delete blocks below
                      </CommandItem>
                      <CommandItem
                        className="justify-between"
                        onSelect={() => {
                          void handleDeleteBlock(block);
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Trash2 className="h-4 w-4" />
                          Delete block
                        </div>
                        <CommandShortcut>
                          {formatShortcut({ key: "Backspace", withMeta: true })}
                        </CommandShortcut>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        )}
      </Popover>
      <AlertDialog open={!!blockToDelete} onOpenChange={(open) => !open && setBlockToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete block</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{blockToDelete?.summary}</strong>? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => blockToDelete && handleDeleteBlock(blockToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

function isLayoutBlockId(page: ReturnType<typeof usePreviewedPage>, blockId: number): boolean {
  if (!page?.layout) return false;
  const layoutBlockIds = new Set([...page.layout.beforeBlockIds, ...page.layout.afterBlockIds]);
  return layoutBlockIds.has(blockId);
}

function useBlockActionsShortcuts() {
  const camoxApp = useCamoxApp();
  const page = usePreviewedPage();
  const { pageBlocks } = usePageBlocks(page);
  const selection = useSelector(previewStore, (state) => state.context.selection);
  const requireDraft = useRequireDraftSource();

  const deleteBlockMutation = useMutation(blockMutations.delete());
  const duplicateBlockMutation = useMutation(blockMutations.duplicate());
  const updatePositionMutation = useUpdateBlockPosition();
  const deleteRepeatableItem = useMutation(repeatableItemMutations.delete());
  const duplicateRepeatableItem = useMutation(repeatableItemMutations.duplicate());

  React.useEffect(() => {
    const actions = [
      {
        id: "delete-selected",
        label: "Delete selected",
        groupLabel: "Preview",
        shortcut: { key: "Backspace", withMeta: true },
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.mode !== "editing-draft") return false;
          const sel = ctx.selection;
          if (!sel) return false;
          if (isLayoutBlockId(page, sel.blockId)) return false;

          const itemId = selectionItemId(sel);
          if (itemId != null) {
            // Item — check if it's in an array with > 1 markers
            if (!page) return false;
            const block = pageBlocks.find((b) => b.id === sel.blockId);
            if (!block) return false;
            for (const [, value] of Object.entries(block.content)) {
              if (!Array.isArray(value)) continue;
              const hasItem = value.some((i: any) => i?._itemId === itemId);
              if (hasItem) return value.length > 1;
            }
            return false;
          }

          // Block — allow delete only if more than 1 page block
          return pageBlocks.length > 1;
        },
        execute: () => {
          if (!requireDraft()) return;
          const sel = previewStore.getSnapshot().context.selection;
          if (!sel) return;

          const itemId = selectionItemId(sel);
          if (itemId != null) {
            deleteRepeatableItem.mutateAsync({ id: itemId }).then(
              () => toast.success("Deleted item"),
              () => toast.error("Could not delete item"),
            );
            previewStore.send({ type: "selectParent" });
            return;
          }

          const block = pageBlocks.find((b) => b.id === sel.blockId);
          deleteBlockMutation.mutateAsync({ id: sel.blockId }).then(
            () => toast.success(`Deleted "${block?.summary || block?.type}" block`),
            () => toast.error("Could not delete block"),
          );
          previewStore.send({ type: "clearSelection" });
        },
      },
      {
        id: "duplicate-selected",
        label: "Duplicate selected",
        groupLabel: "Preview",
        shortcut: { key: "d", withMeta: true },
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.mode !== "editing-draft") return false;
          const sel = ctx.selection;
          if (!sel) return false;
          if (isLayoutBlockId(page, sel.blockId)) return false;
          return true;
        },
        execute: () => {
          if (!requireDraft()) return;
          const sel = previewStore.getSnapshot().context.selection;
          if (!sel) return;

          const itemId = selectionItemId(sel);
          if (itemId != null) {
            duplicateRepeatableItem.mutateAsync({ id: itemId }).then(
              () => toast.success("Duplicated item"),
              () => toast.error("Could not duplicate item"),
            );
            return;
          }

          const block = pageBlocks.find((b) => b.id === sel.blockId);
          duplicateBlockMutation.mutateAsync({ id: sel.blockId }).then(
            () => toast.success(`Duplicated "${block?.summary}" block`),
            () => toast.error("Could not duplicate block"),
          );
        },
      },
      {
        id: "move-block-up",
        label: "Move block up",
        groupLabel: "Preview",
        shortcut: { key: "ArrowUp", withAlt: true },
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.mode !== "editing-draft") return false;
          const sel = ctx.selection;
          if (!sel || !page) return false;
          if (isLayoutBlockId(page, sel.blockId)) return false;
          const index = pageBlocks.findIndex((b) => b.id === sel.blockId);
          return index > 0;
        },
        execute: () => {
          if (!requireDraft()) return;
          const sel = previewStore.getSnapshot().context.selection;
          if (!sel || !page) return;
          const index = pageBlocks.findIndex((b) => b.id === sel.blockId);
          if (index <= 0) return;

          const afterPosition = index > 1 ? pageBlocks[index - 2].position : undefined;
          const beforePosition = pageBlocks[index - 1].position;

          updatePositionMutation
            .mutateAsync({ id: sel.blockId, afterPosition, beforePosition })
            .then(
              () => {},
              () => toast.error("Could not move block"),
            );
        },
      },
      {
        id: "move-block-down",
        label: "Move block down",
        groupLabel: "Preview",
        shortcut: { key: "ArrowDown", withAlt: true },
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.mode !== "editing-draft") return false;
          const sel = ctx.selection;
          if (!sel || !page) return false;
          if (isLayoutBlockId(page, sel.blockId)) return false;
          const index = pageBlocks.findIndex((b) => b.id === sel.blockId);
          return index !== -1 && index < pageBlocks.length - 1;
        },
        execute: () => {
          if (!requireDraft()) return;
          const sel = previewStore.getSnapshot().context.selection;
          if (!sel || !page) return;
          const index = pageBlocks.findIndex((b) => b.id === sel.blockId);
          if (index === -1 || index >= pageBlocks.length - 1) return;

          const afterPosition = pageBlocks[index + 1].position;
          const beforePosition =
            index + 2 < pageBlocks.length ? pageBlocks[index + 2].position : undefined;

          updatePositionMutation
            .mutateAsync({ id: sel.blockId, afterPosition, beforePosition })
            .then(
              () => {},
              () => toast.error("Could not move block"),
            );
        },
      },
      {
        id: "add-block-below",
        label: "Add block below",
        groupLabel: "Preview",
        shortcut: { key: "o" },
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.mode !== "editing-draft") return false;
          return ctx.selection !== null;
        },
        execute: () => {
          if (!requireDraft()) return;
          const sel = previewStore.getSnapshot().context.selection;
          if (!sel || !page) return;
          const block = pageBlocks.find((b) => b.id === sel.blockId);
          if (!block) return;

          previewStore.send({
            type: "openAddBlockSidebar",
            afterPosition: block.position,
          });
        },
      },
      {
        id: "add-block-above",
        label: "Add block above",
        groupLabel: "Preview",
        shortcut: { key: "o", withShift: true },
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.mode !== "editing-draft") return false;
          return ctx.selection !== null;
        },
        execute: () => {
          if (!requireDraft()) return;
          const sel = previewStore.getSnapshot().context.selection;
          if (!sel || !page) return;
          const blockIndex = pageBlocks.findIndex((b) => b.id === sel.blockId);
          if (blockIndex === -1) return;

          const afterPosition = blockIndex > 0 ? pageBlocks[blockIndex - 1].position : "";

          previewStore.send({
            type: "openAddBlockSidebar",
            afterPosition,
          });
        },
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [selection, page, pageBlocks, camoxApp, requireDraft]);
}

export { BlockActionsPopover, useBlockActionsShortcuts };
