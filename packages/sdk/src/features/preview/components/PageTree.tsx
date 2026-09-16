import { Button } from "@camox/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  defaultAnimateLayoutChanges,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSelector } from "@xstate/store-react";
import { Ellipsis, GripVertical, LayoutTemplate, Pencil, Plus } from "lucide-react";
import * as React from "react";

import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { type NormalizedBlock, usePageBlocks } from "@/lib/normalized-data";
import { cn } from "@/lib/utils";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { usePreviewedPage } from "../CamoxPreview";
import type { OverlayMessage } from "../overlayMessages";
import { previewStore, selectPreviewSource } from "../previewStore";
import { BlockActionsPopover } from "./BlockActionsPopover";
import { useUpdateBlockPosition } from "./useUpdateBlockPosition";

const usePreviewSource = () => useSelector(previewStore, selectPreviewSource);

/* -------------------------------------------------------------------------------------------------
 * useBlockTreeItem
 * -----------------------------------------------------------------------------------------------*/

function useBlockTreeItem(block: NormalizedBlock, isDragging = false) {
  const [ellipsisPopoverOpen, setEllipsisPopoverOpen] = React.useState(false);
  const selection = useSelector(previewStore, (state) => state.context.selection);
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);
  const isBlockActive = selection?.blockId === block.id;
  const isBlockSelected = selection?.type === "block" && selection.blockId === block.id;
  const shouldShowHover = !isDragging && !isBlockActive;
  const shouldShowActive = isDragging || isBlockActive;

  const handleBlockMouseEnter = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_BLOCK",
      blockId: String(block.id),
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  const handleBlockMouseLeave = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_BLOCK_END",
      blockId: String(block.id),
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  const toggleSelection = () => {
    if (isBlockSelected) {
      previewStore.send({ type: "clearSelection" });
    } else {
      previewStore.send({
        type: "setFocusedBlock",
        blockId: block.id,
      });
    }
  };

  return {
    ellipsisPopoverOpen,
    setEllipsisPopoverOpen,
    shouldShowHover,
    shouldShowActive,
    handleBlockMouseEnter,
    handleBlockMouseLeave,
    toggleSelection,
  };
}

/* -------------------------------------------------------------------------------------------------
 * BlockTreeItem sub-components
 * -----------------------------------------------------------------------------------------------*/

const BlockTreeItemHeader = ({
  children,
  shouldShowHover,
  shouldShowActive,
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<"div"> & {
  shouldShowHover: boolean;
  shouldShowActive: boolean;
}) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-row justify-between items-center gap-1 px-1 max-w-full rounded-lg text-foreground transition-all hover:transition-none",
      shouldShowHover && "hover:bg-accent/75",
      shouldShowActive && "bg-accent text-accent-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

const BlockTreeItemTrigger = ({
  displayText,
  onClick,
}: {
  displayText: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={cn(
      "cursor-default flex-1 truncate py-2 text-sm text-left rounded-sm min-w-0",
      "focus-visible:underline outline-none focus-visible:decoration-ring/50 focus-visible:decoration-4",
    )}
    title={displayText}
    onClick={onClick}
  >
    {displayText}
  </button>
);

const BlockTreeItemEllipsis = ({
  open,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof Button> & { open: boolean }) => (
  <Button
    variant="ghost"
    size="icon-sm"
    className={cn(
      "text-muted-foreground hover:text-foreground",
      open ? "flex" : "hidden group-hover:flex group-focus-within:flex",
      className,
    )}
    {...props}
  >
    <Ellipsis className="size-4" />
  </Button>
);

/* -------------------------------------------------------------------------------------------------
 * SortableBlock
 * -----------------------------------------------------------------------------------------------*/

interface SortableBlockProps {
  block: NormalizedBlock;
}

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  const { isSorting, wasDragging } = args;
  if (isSorting || wasDragging) return false;
  return defaultAnimateLayoutChanges(args);
};

const SortableBlock = ({ block }: SortableBlockProps) => {
  const [gripPopoverOpen, setGripPopoverOpen] = React.useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(block.id),
    animateLayoutChanges,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };
  const ctx = useBlockTreeItem(block, isDragging);

  const gripButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground flex cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <span className="sr-only">Click and use arrow keys to reorder</span>
      <GripVertical className="h-4 w-4" />
    </Button>
  );

  return (
    <BlockTreeItemHeader
      ref={setNodeRef}
      style={style}
      className="group"
      shouldShowHover={ctx.shouldShowHover}
      shouldShowActive={ctx.shouldShowActive}
      onMouseEnter={ctx.handleBlockMouseEnter}
      onMouseLeave={ctx.handleBlockMouseLeave}
    >
      <BlockActionsPopover block={block} open={gripPopoverOpen} onOpenChange={setGripPopoverOpen}>
        {gripButton}
      </BlockActionsPopover>
      <BlockTreeItemTrigger
        displayText={block.summary || block.type}
        onClick={ctx.toggleSelection}
      />
      <BlockActionsPopover
        block={block}
        open={ctx.ellipsisPopoverOpen}
        onOpenChange={ctx.setEllipsisPopoverOpen}
      >
        <BlockTreeItemEllipsis open={ctx.ellipsisPopoverOpen} />
      </BlockActionsPopover>
    </BlockTreeItemHeader>
  );
};

/* -------------------------------------------------------------------------------------------------
 * LayoutBlockItem
 * -----------------------------------------------------------------------------------------------*/

interface LayoutBlockItemProps {
  block: NormalizedBlock;
  layoutName: string;
  derived?: boolean;
}

export const LayoutBlockItem = ({ block, layoutName, derived = false }: LayoutBlockItemProps) => {
  const camoxApp = useCamoxApp();
  const blockDef = camoxApp.getBlockById(block.type);
  const ctx = useBlockTreeItem(block);
  const requireDraft = useRequireDraftSource();
  const displayText = blockDef?._internal.title ?? block.type;

  return (
    <BlockTreeItemHeader
      className="group"
      shouldShowHover={ctx.shouldShowHover}
      shouldShowActive={ctx.shouldShowActive}
      onMouseEnter={ctx.handleBlockMouseEnter}
      onMouseLeave={ctx.handleBlockMouseLeave}
    >
      <div className="text-muted-foreground flex size-8 shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger>
            <LayoutTemplate className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>
            From <span className="font-semibold">{layoutName}</span> layout.
            <br />
            {blockDef?._internal.synced
              ? "Synced: editing this block updates it across all layouts and pages"
              : "Changing the content may affect other pages"}
          </TooltipContent>
        </Tooltip>
      </div>
      <BlockTreeItemTrigger displayText={displayText} onClick={ctx.toggleSelection} />
      {derived ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hidden group-focus-within:flex group-hover:flex"
          aria-label={`Edit ${displayText} in form`}
          onClick={() => {
            if (!requireDraft()) return;
            previewStore.send({ type: "openBlockContentSheet", blockId: block.id });
          }}
        >
          <Pencil className="size-4" />
        </Button>
      ) : (
        <BlockActionsPopover
          block={block}
          open={ctx.ellipsisPopoverOpen}
          onOpenChange={ctx.setEllipsisPopoverOpen}
          isLayoutBlock
          layoutPlacement={block.placement as "before" | "after"}
        >
          <BlockTreeItemEllipsis open={ctx.ellipsisPopoverOpen} />
        </BlockActionsPopover>
      )}
    </BlockTreeItemHeader>
  );
};

/* -------------------------------------------------------------------------------------------------
 * PageTree
 * -----------------------------------------------------------------------------------------------*/

const BlockInsertionIndicator = () => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div ref={ref} className="pointer-events-none relative z-30 h-2 shrink-0" aria-hidden="true">
      <div className="bg-primary absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full motion-safe:animate-pulse">
        <div className="bg-primary absolute -top-0.5 -left-0.5 size-1.5 rounded-full" />
      </div>
    </div>
  );
};

const PageTree = () => {
  const page = usePreviewedPage();
  const isAddBlockSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSidebarOpen,
  );
  const peekedBlockPosition = useSelector(
    previewStore,
    (state) => state.context.peekedBlockPosition,
  );
  const previewSource = usePreviewSource();
  const requireDraft = useRequireDraftSource();
  const {
    pageBlocks,
    beforeBlocks: layoutBeforeBlocks,
    afterBlocks: layoutAfterBlocks,
  } = usePageBlocks(page, previewSource);
  const camoxApp = useCamoxApp();

  const updatePosition = useUpdateBlockPosition();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !page) {
      setActiveId(null);
      return;
    }

    // A drag may finish after switching to live preview.
    if (!requireDraft()) {
      setActiveId(null);
      return;
    }

    // Find the old and new indices
    const oldIndex = pageBlocks.findIndex((block) => String(block.id) === active.id);
    const newIndex = pageBlocks.findIndex((block) => String(block.id) === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      setActiveId(null);
      return;
    }

    // Determine afterPosition and beforePosition based on new index
    // When dragging down (oldIndex < newIndex), the block is inserted after newIndex
    // When dragging up (oldIndex > newIndex), the block is inserted before newIndex
    let afterPosition: string | undefined;
    let beforePosition: string | undefined;

    if (oldIndex < newIndex) {
      // Dragging down: insert after the target position
      afterPosition = pageBlocks[newIndex].position;
      beforePosition =
        newIndex < pageBlocks.length - 1 ? pageBlocks[newIndex + 1].position : undefined;
    } else {
      // Dragging up: insert before the target position
      afterPosition = newIndex > 0 ? pageBlocks[newIndex - 1].position : undefined;
      beforePosition = pageBlocks[newIndex].position;
    }

    // mutate() triggers onMutate synchronously, reordering the list
    // before dnd-kit resets transforms on neighboring items
    updatePosition.mutate({
      id: Number(active.id),
      afterPosition,
      beforePosition,
    });
    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  if (!page) {
    return null;
  }

  const layout = page.layout ? camoxApp.getLayoutById(page.layout.layoutId) : undefined;
  const nextBlockIndex = pageBlocks.findIndex(
    (block) => peekedBlockPosition != null && block.position > peekedBlockPosition,
  );
  const insertionIndex =
    peekedBlockPosition === "" ? 0 : nextBlockIndex === -1 ? pageBlocks.length : nextBlockIndex;

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {layoutBeforeBlocks.map((block) => (
          <LayoutBlockItem
            key={String(block.id)}
            block={block}
            layoutName={layout?._internal.title ?? "Unknown"}
          />
        ))}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext
            items={pageBlocks.map((block) => String(block.id))}
            strategy={verticalListSortingStrategy}
          >
            {pageBlocks.map((block, index) => (
              <React.Fragment key={String(block.id)}>
                {isAddBlockSidebarOpen && index === insertionIndex && <BlockInsertionIndicator />}
                <SortableBlock block={block} />
              </React.Fragment>
            ))}
            {isAddBlockSidebarOpen && insertionIndex === pageBlocks.length && (
              <BlockInsertionIndicator />
            )}
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeId
              ? (() => {
                  const activeBlock = pageBlocks.find((b) => String(b.id) === activeId);
                  if (!activeBlock) return null;
                  return (
                    <div className="bg-accent text-accent-foreground rounded-lg shadow-md">
                      <div className="flex items-center gap-1 px-1 py-2 text-sm">
                        <GripVertical className="text-muted-foreground mx-1.5 h-4 w-4" />
                        <span className="truncate">{activeBlock.summary}</span>
                      </div>
                    </div>
                  );
                })()
              : null}
          </DragOverlay>
        </DndContext>
        {layoutAfterBlocks.map((block) => (
          <LayoutBlockItem
            key={String(block.id)}
            block={block}
            layoutName={layout?._internal.title ?? "Unknown"}
          />
        ))}
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          if (!requireDraft()) return;
          previewStore.send({
            type: "openAddBlockSidebar",
            via: "page-tree",
          });
        }}
      >
        <Plus />
        Add block
      </Button>
    </>
  );
};

export { PageTree };
