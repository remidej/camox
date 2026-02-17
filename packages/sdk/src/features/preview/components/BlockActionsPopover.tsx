import * as React from "react";
import { Copy, Pen, Trash2 } from "lucide-react";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSelector } from "@xstate/store/react";
import { previewStore, type SelectionBreadcrumb } from "../previewStore";
import { Doc, Id } from "camox/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import { toast } from "sonner";
import { usePreviewedPage } from "../CamoxPreview";
import { Button } from "@/components/ui/button";
import { formatShortcut } from "@/lib/utils";
import { actionsStore } from "../../provider/actionsStore";
import type { Action } from "../../provider/actionsStore";

interface BlockActionsPopoverProps {
  block: Doc<"blocks"> | undefined | null;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BlockActionsPopover = ({
  block,
  children,
  open,
  onOpenChange,
  align = "start",
}: BlockActionsPopoverProps) => {
  const [blockToDelete, setBlockToDelete] =
    React.useState<Doc<"blocks"> | null>(null);

  const page = usePreviewedPage();
  const deleteBlockMutation = useMutation(api.blocks.deleteBlock);
  const deleteBlocksMutation = useMutation(api.blocks.deleteBlocks);
  const duplicateBlockMutation = useMutation(api.blocks.duplicateBlock);

  const handleDeleteBlock = async (block: Doc<"blocks">) => {
    try {
      await deleteBlockMutation({ blockId: block._id });
      toast.success(`Deleted "${block.summary}" block`);
    } catch (error) {
      console.error("Failed to delete block:", error);
      toast.error("Could not delete block");
    } finally {
      setBlockToDelete(null);
    }
  };

  const handleDuplicateBlock = async (block: Doc<"blocks">) => {
    try {
      await duplicateBlockMutation({ blockId: block._id });
      toast.success(`Duplicated "${block.summary}" block`);
    } catch (error) {
      console.error("Failed to duplicate block:", error);
      toast.error("Could not duplicate block");
    }
  };

  const handleAddBlockAbove = (block: Doc<"blocks">) => {
    if (!page) return;

    const blockIndex = page.blocks.findIndex((b) => b._id === block._id);
    const afterPosition =
      blockIndex > 0 ? page.blocks[blockIndex - 1].position : null;

    previewStore.send({
      type: "openAddBlockSheet",
      afterPosition,
    });
  };

  const handleAddBlockBelow = (block: Doc<"blocks">) => {
    previewStore.send({
      type: "openAddBlockSheet",
      afterPosition: block.position,
    });
  };

  const getBlocksAbove = (block: Doc<"blocks">) => {
    if (!page) return [];
    const blockIndex = page.blocks.findIndex((b) => b._id === block._id);
    return page.blocks.slice(0, blockIndex);
  };

  const getBlocksBelow = (block: Doc<"blocks">) => {
    if (!page) return [];
    const blockIndex = page.blocks.findIndex((b) => b._id === block._id);
    return page.blocks.slice(blockIndex + 1);
  };

  const handleDeleteBlocksAbove = async (block: Doc<"blocks">) => {
    const blocksAbove = getBlocksAbove(block);
    if (blocksAbove.length === 0) return;

    try {
      await deleteBlocksMutation({ blockIds: blocksAbove.map((b) => b._id) });
      toast.success(
        `Deleted ${blocksAbove.length} block${blocksAbove.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      console.error("Failed to delete blocks above:", error);
      toast.error("Could not delete blocks");
    }
  };

  const handleDeleteBlocksBelow = async (block: Doc<"blocks">) => {
    const blocksBelow = getBlocksBelow(block);
    if (blocksBelow.length === 0) return;

    try {
      await deleteBlocksMutation({ blockIds: blocksBelow.map((b) => b._id) });
      toast.success(
        `Deleted ${blocksBelow.length} block${blocksBelow.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      console.error("Failed to delete blocks below:", error);
      toast.error("Could not delete blocks");
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        {block && (
          <PopoverContent className="w-[300px] p-0" align={align}>
            <Command>
              <CommandInput placeholder="Search actions..." />
              <CommandList className="max-h-[350px]">
                <CommandGroup>
                  <CommandItem
                    className="justify-between"
                    onSelect={() => {
                      previewStore.send({
                        type: "openBlockContentSheet",
                        blockId: block._id,
                      });
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex gap-2 items-center">
                      <Pen className="h-4 w-4" />
                      Edit in form
                    </div>
                    {formatShortcut({ key: "j", withMeta: true })}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    className="justify-between"
                    onSelect={() => {
                      handleAddBlockBelow(block);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex gap-2 items-center">
                      <span className="w-4" />
                      Add block below
                    </div>
                    {formatShortcut({ key: "o" })}
                  </CommandItem>
                  <CommandItem
                    className="justify-between"
                    onSelect={() => {
                      handleAddBlockAbove(block);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex gap-2 items-center">
                      <span className="w-4" />
                      Add block above
                    </div>
                    {formatShortcut({ key: "o", withShift: true })}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    className="justify-between"
                    onSelect={() => {
                      handleDuplicateBlock(block);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex gap-2 items-center">
                      <Copy className="h-4 w-4" />
                      Duplicate block
                    </div>
                    {formatShortcut({ key: "d", withMeta: true })}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      handleDeleteBlocksAbove(block);
                      onOpenChange(false);
                    }}
                    disabled={getBlocksAbove(block).length === 0}
                  >
                    <span className="w-4" />
                    Delete blocks above
                  </CommandItem>
                  <CommandItem
                    onSelect={() => {
                      handleDeleteBlocksBelow(block);
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
                      handleDeleteBlock(block);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex gap-2 items-center">
                      <Trash2 className="h-4 w-4" />
                      Delete block
                    </div>
                    {formatShortcut({ key: "Backspace", withMeta: true })}
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        )}
      </Popover>
      <AlertDialog
        open={!!blockToDelete}
        onOpenChange={(open) => !open && setBlockToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete block</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{blockToDelete?.summary}</strong>? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => blockToDelete && handleDeleteBlock(blockToDelete)}
              asChild
            >
              <Button variant="destructive">Delete</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

/**
 * Walk breadcrumbs from deepest to shallowest and return the first
 * RepeatableObject or Block entry — i.e. the closest ancestor that
 * can be duplicated / deleted.
 */
function findClosestActionable(breadcrumbs: SelectionBreadcrumb[]) {
  for (let i = breadcrumbs.length - 1; i >= 0; i--) {
    const crumb = breadcrumbs[i];
    if (crumb.type === "RepeatableObject") return crumb;
    if (crumb.type === "Block") return crumb;
  }
  return null;
}

function useBlockActionsShortcuts() {
  const page = usePreviewedPage();
  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );

  const deleteBlockMutation = useMutation(api.blocks.deleteBlock);
  const duplicateBlockMutation = useMutation(api.blocks.duplicateBlock);
  const updateBlockPositionMutation = useMutation(
    api.blocks.updateBlockPosition,
  );
  const deleteRepeatableItemMutation = useMutation(
    api.repeatableItems.deleteRepeatableItem,
  );
  const duplicateRepeatableItemMutation = useMutation(
    api.repeatableItems.duplicateRepeatableItem,
  );

  React.useEffect(() => {
    const actions = [
      {
        id: "delete-selected",
        label: "Delete selected",
        groupLabel: "Preview",
        shortcut: { key: "Backspace", withMeta: true },
        icon: "Trash2",
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.isContentLocked || ctx.isPresentationMode) return false;
          const breadcrumbs = ctx.selectionBreadcrumbs;
          const target = findClosestActionable(breadcrumbs);
          if (!target) return false;

          if (target.type === "RepeatableObject") {
            if (!page) return false;
            const blockCrumb = breadcrumbs.find((b) => b.type === "Block");
            if (!blockCrumb) return false;
            const block = page.blocks.find((b) => b._id === blockCrumb.id);
            if (!block) return false;
            for (const [, value] of Object.entries(block.content)) {
              if (!Array.isArray(value)) continue;
              const item = value.find(
                (i: Doc<"repeatableItems">) => i._id === target.id,
              );
              if (item) return value.length > 1;
            }
            return false;
          }

          // Block — allow delete only if more than 1 block
          return (page?.blocks.length ?? 0) > 1;
        },
        execute: () => {
          const breadcrumbs =
            previewStore.getSnapshot().context.selectionBreadcrumbs;
          const target = findClosestActionable(breadcrumbs);
          if (!target) return;

          if (target.type === "RepeatableObject") {
            const itemId = target.id as Id<"repeatableItems">;
            deleteRepeatableItemMutation({ itemId }).then(
              () => toast.success("Deleted item"),
              () => toast.error("Could not delete item"),
            );
            previewStore.send({ type: "selectParentBreadcrumb" });
            return;
          }

          const blockId = target.id as Id<"blocks">;
          const block = page?.blocks.find((b) => b._id === blockId);
          deleteBlockMutation({ blockId }).then(
            () => toast.success(`Deleted "${block?.summary}" block`),
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
        icon: "Copy",
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.isContentLocked || ctx.isPresentationMode) return false;
          return findClosestActionable(ctx.selectionBreadcrumbs) !== null;
        },
        execute: () => {
          const breadcrumbs =
            previewStore.getSnapshot().context.selectionBreadcrumbs;
          const target = findClosestActionable(breadcrumbs);
          if (!target) return;

          if (target.type === "RepeatableObject") {
            const itemId = target.id as Id<"repeatableItems">;
            duplicateRepeatableItemMutation({ itemId }).then(
              () => toast.success("Duplicated item"),
              () => toast.error("Could not duplicate item"),
            );
            return;
          }

          const blockId = target.id as Id<"blocks">;
          const block = page?.blocks.find((b) => b._id === blockId);
          duplicateBlockMutation({ blockId }).then(
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
        icon: "ArrowUp",
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.isContentLocked || ctx.isPresentationMode) return false;
          const blockCrumb = ctx.selectionBreadcrumbs.find(
            (b) => b.type === "Block",
          );
          if (!blockCrumb || !page) return false;
          const index = page.blocks.findIndex((b) => b._id === blockCrumb.id);
          return index > 0;
        },
        execute: () => {
          const blockCrumb = previewStore
            .getSnapshot()
            .context.selectionBreadcrumbs.find((b) => b.type === "Block");
          if (!blockCrumb || !page) return;
          const blockId = blockCrumb.id as Id<"blocks">;
          const index = page.blocks.findIndex((b) => b._id === blockId);
          if (index <= 0) return;

          const afterPosition =
            index > 1 ? page.blocks[index - 2].position : undefined;
          const beforePosition = page.blocks[index - 1].position;

          updateBlockPositionMutation({
            blockId,
            afterPosition,
            beforePosition,
          }).then(
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
        icon: "ArrowDown",
        checkIfAvailable: () => {
          const ctx = previewStore.getSnapshot().context;
          if (ctx.isContentLocked || ctx.isPresentationMode) return false;
          const blockCrumb = ctx.selectionBreadcrumbs.find(
            (b) => b.type === "Block",
          );
          if (!blockCrumb || !page) return false;
          const index = page.blocks.findIndex((b) => b._id === blockCrumb.id);
          return index !== -1 && index < page.blocks.length - 1;
        },
        execute: () => {
          const blockCrumb = previewStore
            .getSnapshot()
            .context.selectionBreadcrumbs.find((b) => b.type === "Block");
          if (!blockCrumb || !page) return;
          const blockId = blockCrumb.id as Id<"blocks">;
          const index = page.blocks.findIndex((b) => b._id === blockId);
          if (index === -1 || index >= page.blocks.length - 1) return;

          const afterPosition = page.blocks[index + 1].position;
          const beforePosition =
            index + 2 < page.blocks.length
              ? page.blocks[index + 2].position
              : undefined;

          updateBlockPositionMutation({
            blockId,
            afterPosition,
            beforePosition,
          }).then(
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
          if (ctx.isContentLocked || ctx.isPresentationMode) return false;
          return (
            ctx.selectionBreadcrumbs.find((b) => b.type === "Block") !== null
          );
        },
        execute: () => {
          const blockCrumb = previewStore
            .getSnapshot()
            .context.selectionBreadcrumbs.find((b) => b.type === "Block");
          if (!blockCrumb || !page) return;
          const block = page.blocks.find((b) => b._id === blockCrumb.id);
          if (!block) return;

          previewStore.send({
            type: "openAddBlockSheet",
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
          if (ctx.isContentLocked || ctx.isPresentationMode) return false;
          return (
            ctx.selectionBreadcrumbs.find((b) => b.type === "Block") !== null
          );
        },
        execute: () => {
          const blockCrumb = previewStore
            .getSnapshot()
            .context.selectionBreadcrumbs.find((b) => b.type === "Block");
          if (!blockCrumb || !page) return;
          const blockIndex = page.blocks.findIndex(
            (b) => b._id === blockCrumb.id,
          );
          if (blockIndex === -1) return;

          const afterPosition =
            blockIndex > 0 ? page.blocks[blockIndex - 1].position : null;

          previewStore.send({
            type: "openAddBlockSheet",
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
  }, [
    selectionBreadcrumbs,
    page,
    deleteBlockMutation,
    duplicateBlockMutation,
    updateBlockPositionMutation,
    deleteRepeatableItemMutation,
    duplicateRepeatableItemMutation,
  ]);
}

export { BlockActionsPopover, useBlockActionsShortcuts };
