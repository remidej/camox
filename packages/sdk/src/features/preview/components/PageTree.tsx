import { Button } from "@camox/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Accordion from "@radix-ui/react-accordion";
import { useLocation } from "@tanstack/react-router";
import { useSelector } from "@xstate/store/react";
import { api } from "camox/server/api";
import { Doc, Id } from "camox/server/dataModel";
import { useMutation } from "convex/react";
import { generateKeyBetween } from "fractional-indexing";
import { Ellipsis, GripVertical, LayoutTemplate, Plus, Type } from "lucide-react";
import * as React from "react";

import { fieldTypesDictionary } from "@/core/lib/fieldTypes";
import { cn } from "@/lib/utils";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { usePreviewedPage } from "../CamoxPreview";
import type { OverlayMessage } from "../overlayMessages";
import { previewStore } from "../previewStore";
import { BlockActionsPopover } from "./BlockActionsPopover";

/* -------------------------------------------------------------------------------------------------
 * useEmbedTitle
 * -----------------------------------------------------------------------------------------------*/

function useEmbedTitle(url: string | null) {
  const [title, setTitle] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!url) return;
    setTitle(null);
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((res) => res.text())
      .then((html) => {
        const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (match?.[1]) setTitle(match[1].trim());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [url]);

  return title;
}

/* -------------------------------------------------------------------------------------------------
 * FieldItem
 * -----------------------------------------------------------------------------------------------*/

type FieldItemProps = {
  fieldName: string;
  value: unknown;
  fieldType: string | undefined;
  schemaTitle: string | undefined;
  arrayItemType?: string;
  isSelected: boolean;
  onFieldClick: () => void;
  onFieldDoubleClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

const FieldItem = ({
  fieldName,
  value,
  fieldType,
  schemaTitle,
  arrayItemType,
  isSelected,
  onFieldClick,
  onFieldDoubleClick,
  onMouseEnter,
  onMouseLeave,
}: FieldItemProps) => {
  const embedUrl = fieldType === "Embed" ? (value as string) : null;
  const fetchedEmbedTitle = useEmbedTitle(embedUrl);

  const fieldDef =
    fieldType != null ? fieldTypesDictionary[fieldType as keyof typeof fieldTypesDictionary] : null;
  const displayValue = fieldDef
    ? fieldDef.getLabel(value, {
        schemaTitle,
        fieldName,
        fetchedTitle: fetchedEmbedTitle,
      })
    : JSON.stringify(value);

  const FieldIcon = fieldDef?.getIcon({ arrayItemType }) ?? Type;

  return (
    <li
      className={cn(
        "flex items-center gap-1.5 rounded-lg pl-2 pr-1 py-2 cursor-default group/field",
        isSelected ? "bg-accent" : "hover:bg-accent/75",
      )}
      onClick={() => fieldType && onFieldClick()}
      onDoubleClick={() => fieldType && onFieldDoubleClick()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <FieldIcon className="size-4 shrink-0" />
      <span className="text-accent-foreground truncate select-none">{displayValue}</span>
    </li>
  );
};

/* -------------------------------------------------------------------------------------------------
 * BlockFields
 * -----------------------------------------------------------------------------------------------*/

type BlockFieldsProps = {
  block: Doc<"blocks">;
};

const BlockFields = ({ block }: BlockFieldsProps) => {
  const camoxApp = useCamoxApp();
  const blockDef = camoxApp.getBlockById(block.type);
  const schemaProperties = blockDef?.contentSchema.properties;

  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);

  // Check if a field is selected (breadcrumbs has block + field)
  const selectedFieldName =
    selectionBreadcrumbs.length === 2 && selectionBreadcrumbs[0]?.id === block._id
      ? selectionBreadcrumbs[1]?.id
      : null;

  const handleFieldClick = (fieldName: string, fieldType: string) => {
    previewStore.send({
      type: "setSelectedField",
      blockId: block._id,
      fieldName,
      fieldType: fieldType as "String" | "RepeatableObject",
    });
  };

  const handleFieldDoubleClick = (fieldName: string, fieldType: string) => {
    const fieldDef = fieldTypesDictionary[fieldType as keyof typeof fieldTypesDictionary];
    fieldDef.onTreeDoubleClick({ blockId: block._id, fieldName });
  };

  const handleFieldMouseEnter = (fieldName: string, isRepeatable: boolean) => {
    if (!iframeElement?.contentWindow) return;
    if (isRepeatable) {
      const message: OverlayMessage = {
        type: "CAMOX_HOVER_REPEATER",
        blockId: block._id,
        fieldName,
      };
      iframeElement.contentWindow.postMessage(message, "*");
    } else {
      const fieldId = `${block._id}__${fieldName}`;
      const message: OverlayMessage = {
        type: "CAMOX_HOVER_FIELD",
        fieldId,
      };
      iframeElement.contentWindow.postMessage(message, "*");
    }
  };

  const handleFieldMouseLeave = (fieldName: string, isRepeatable: boolean) => {
    if (!iframeElement?.contentWindow) return;
    if (isRepeatable) {
      const message: OverlayMessage = {
        type: "CAMOX_HOVER_REPEATER_END",
        blockId: block._id,
        fieldName,
      };
      iframeElement.contentWindow.postMessage(message, "*");
    } else {
      const fieldId = `${block._id}__${fieldName}`;
      const message: OverlayMessage = {
        type: "CAMOX_HOVER_FIELD_END",
        fieldId,
      };
      iframeElement.contentWindow.postMessage(message, "*");
    }
  };

  return (
    <ul className="my-1 space-y-1 pr-1 pl-7">
      {Object.keys(schemaProperties ?? {}).map((fieldName) => {
        const value = block.content[fieldName];
        const fieldSchema = schemaProperties?.[fieldName];
        if (!fieldSchema) return null;
        const fieldType = fieldSchema.fieldType;
        const isRepeatable = fieldType === "RepeatableObject";
        return (
          <FieldItem
            key={fieldName}
            fieldName={fieldName}
            value={value}
            fieldType={fieldType}
            schemaTitle={fieldSchema?.title}
            arrayItemType={fieldSchema?.arrayItemType}
            isSelected={selectedFieldName === fieldName}
            onFieldClick={() => handleFieldClick(fieldName, fieldType!)}
            onFieldDoubleClick={() => handleFieldDoubleClick(fieldName, fieldType!)}
            onMouseEnter={() => handleFieldMouseEnter(fieldName, isRepeatable)}
            onMouseLeave={() => handleFieldMouseLeave(fieldName, isRepeatable)}
          />
        );
      })}
    </ul>
  );
};

/* -------------------------------------------------------------------------------------------------
 * useBlockTreeItem
 * -----------------------------------------------------------------------------------------------*/

function useBlockTreeItem(block: Doc<"blocks">, isSelected: boolean, isDragging = false) {
  const [ellipsisPopoverOpen, setEllipsisPopoverOpen] = React.useState(false);
  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);
  const isParentOfSelection = selectionBreadcrumbs.at(-2)?.id === block._id;
  const shouldShowHover = !isDragging && !isSelected;
  const shouldShowActive = isDragging || (isSelected && !isParentOfSelection);

  const handleBlockMouseEnter = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_BLOCK",
      blockId: block._id,
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  const handleBlockMouseLeave = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_BLOCK_END",
      blockId: block._id,
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  const toggleSelection = () => {
    if (isSelected) {
      previewStore.send({ type: "clearSelection" });
    } else {
      previewStore.send({
        type: "setFocusedBlock",
        blockId: block._id,
      });
    }
  };

  return {
    ellipsisPopoverOpen,
    setEllipsisPopoverOpen,
    isParentOfSelection,
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
  isParentOfSelection,
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<"div"> & {
  shouldShowHover: boolean;
  shouldShowActive: boolean;
  isParentOfSelection: boolean;
}) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-row justify-between items-center gap-1 px-1 max-w-full rounded-lg text-foreground transition-all hover:transition-none",
      shouldShowHover && "hover:bg-accent/75",
      shouldShowActive && "bg-accent text-accent-foreground",
      isParentOfSelection && "bg-accent/25",
      "data-[state=open]:rounded-b-none",
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
  <div className="flex flex-1 items-center gap-1 overflow-x-hidden">
    <Accordion.Trigger asChild>
      <button
        className={cn(
          "cursor-default flex-1 truncate py-2 text-sm text-left rounded-sm",
          "focus-visible:underline outline-none focus-visible:decoration-ring/50 focus-visible:decoration-4",
        )}
        title={displayText}
        onClick={onClick}
      >
        {displayText}
      </button>
    </Accordion.Trigger>
  </div>
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

const BlockTreeItemContent = ({ block }: { block: Doc<"blocks"> }) => (
  <Accordion.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down text-muted-foreground data-[state=open]:bg-accent/25 overflow-hidden rounded-b-lg text-sm">
    <BlockFields block={block} />
  </Accordion.Content>
);

/* -------------------------------------------------------------------------------------------------
 * SortableBlock
 * -----------------------------------------------------------------------------------------------*/

interface SortableBlockProps {
  block: Doc<"blocks">;
  isSelected: boolean;
}

const SortableBlock = ({ block, isSelected }: SortableBlockProps) => {
  const [gripPopoverOpen, setGripPopoverOpen] = React.useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block._id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const ctx = useBlockTreeItem(block, isSelected, isDragging);

  return (
    <Accordion.Root type="single" collapsible value={isSelected ? block._id : ""}>
      <Accordion.Item
        value={block._id}
        ref={setNodeRef}
        style={style}
        className="group"
        onMouseEnter={ctx.handleBlockMouseEnter}
        onMouseLeave={ctx.handleBlockMouseLeave}
      >
        <Accordion.Header asChild>
          <BlockTreeItemHeader
            shouldShowHover={ctx.shouldShowHover}
            shouldShowActive={ctx.shouldShowActive}
            isParentOfSelection={ctx.isParentOfSelection}
          >
            <BlockActionsPopover
              block={block}
              open={gripPopoverOpen}
              onOpenChange={setGripPopoverOpen}
            >
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
            </BlockActionsPopover>
            <BlockTreeItemTrigger displayText={block.summary} onClick={ctx.toggleSelection} />
            <BlockActionsPopover
              block={block}
              open={ctx.ellipsisPopoverOpen}
              onOpenChange={ctx.setEllipsisPopoverOpen}
            >
              <BlockTreeItemEllipsis open={ctx.ellipsisPopoverOpen} />
            </BlockActionsPopover>
          </BlockTreeItemHeader>
        </Accordion.Header>
        <BlockTreeItemContent block={block} />
      </Accordion.Item>
    </Accordion.Root>
  );
};

/* -------------------------------------------------------------------------------------------------
 * LayoutBlockItem
 * -----------------------------------------------------------------------------------------------*/

interface LayoutBlockItemProps {
  block: Doc<"blocks">;
  isSelected: boolean;
  layoutName: string;
}

const LayoutBlockItem = ({ block, isSelected, layoutName }: LayoutBlockItemProps) => {
  const camoxApp = useCamoxApp();
  const blockDef = camoxApp.getBlockById(block.type);
  const ctx = useBlockTreeItem(block, isSelected);
  const displayText = blockDef?.title ?? block.type;

  return (
    <Accordion.Root type="single" collapsible value={isSelected ? block._id : ""}>
      <Accordion.Item
        value={block._id}
        className="group"
        onMouseEnter={ctx.handleBlockMouseEnter}
        onMouseLeave={ctx.handleBlockMouseLeave}
      >
        <Accordion.Header asChild>
          <BlockTreeItemHeader
            shouldShowHover={ctx.shouldShowHover}
            shouldShowActive={ctx.shouldShowActive}
            isParentOfSelection={ctx.isParentOfSelection}
          >
            <div className="text-muted-foreground flex size-7 shrink-0 items-center justify-center">
              <Tooltip delayDuration={500}>
                <TooltipTrigger>
                  <LayoutTemplate className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>
                  From <span className="font-semibold">{layoutName}</span> layout.
                  <br />
                  Changing the content may affect other pages
                </TooltipContent>
              </Tooltip>
            </div>
            <BlockTreeItemTrigger displayText={displayText} onClick={ctx.toggleSelection} />
            <BlockActionsPopover
              block={block}
              open={ctx.ellipsisPopoverOpen}
              onOpenChange={ctx.setEllipsisPopoverOpen}
              isLayoutBlock
              layoutPlacement={block.placement as "before" | "after"}
            >
              <BlockTreeItemEllipsis open={ctx.ellipsisPopoverOpen} />
            </BlockActionsPopover>
          </BlockTreeItemHeader>
        </Accordion.Header>
        <BlockTreeItemContent block={block} />
      </Accordion.Item>
    </Accordion.Root>
  );
};

/* -------------------------------------------------------------------------------------------------
 * PageTree
 * -----------------------------------------------------------------------------------------------*/

const PageTree = () => {
  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  // Get the block ID from breadcrumbs for selection state
  const focusedBlockId = selectionBreadcrumbs[0]?.id ?? null;
  const { pathname } = useLocation();
  const page = usePreviewedPage();
  const camoxApp = useCamoxApp();

  const updatePositionMutation = useMutation(api.blocks.updateBlockPosition).withOptimisticUpdate(
    (localStore, args) => {
      // Get the current page data
      const currentPage = localStore.getQuery(api.pages.getPage, {
        fullPath: pathname,
      });

      if (!currentPage) return;

      // Find the block being moved
      const blockIndex = currentPage.blocks.findIndex((block) => block._id === args.blockId);

      if (blockIndex === -1) return;

      const block = currentPage.blocks[blockIndex];

      // Calculate the new position
      const newPosition = generateKeyBetween(
        args.afterPosition ?? null,
        args.beforePosition ?? null,
      );

      // Update the block's position
      const updatedBlock = { ...block, position: newPosition };

      // Create new array with updated block
      const newBlocks = [...currentPage.blocks];
      newBlocks[blockIndex] = updatedBlock;

      // Re-sort the blocks by position
      newBlocks.sort((a, b) => {
        if (a.position < b.position) return -1;
        if (a.position > b.position) return 1;
        return 0;
      });

      // Update the page in the local store
      localStore.setQuery(
        api.pages.getPage,
        { fullPath: pathname },
        { ...currentPage, blocks: newBlocks },
      );
    },
  );

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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !page) {
      return;
    }

    // Find the old and new indices
    const oldIndex = page.blocks.findIndex((block) => block._id === active.id);
    const newIndex = page.blocks.findIndex((block) => block._id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Determine afterPosition and beforePosition based on new index
    // When dragging down (oldIndex < newIndex), the block is inserted after newIndex
    // When dragging up (oldIndex > newIndex), the block is inserted before newIndex
    let afterPosition: string | undefined;
    let beforePosition: string | undefined;

    if (oldIndex < newIndex) {
      // Dragging down: insert after the target position
      afterPosition = page.blocks[newIndex].position;
      beforePosition =
        newIndex < page.blocks.length - 1 ? page.blocks[newIndex + 1].position : undefined;
    } else {
      // Dragging up: insert before the target position
      afterPosition = newIndex > 0 ? page.blocks[newIndex - 1].position : undefined;
      beforePosition = page.blocks[newIndex].position;
    }

    await updatePositionMutation({
      blockId: active.id as Id<"blocks">,
      afterPosition,
      beforePosition,
    });
  };

  if (!page) {
    return null;
  }

  const layout = page.layout ? camoxApp.getLayoutById(page.layout.layoutId) : undefined;
  const beforeBlocks = page.layout?.beforeBlocks ?? [];
  const afterBlocks = page.layout?.afterBlocks ?? [];

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {beforeBlocks.map((block) => (
          <LayoutBlockItem
            key={block._id}
            block={block}
            isSelected={focusedBlockId === block._id}
            layoutName={layout?.title ?? "Unknown"}
          />
        ))}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext
            items={page.blocks.map((block) => block._id)}
            strategy={verticalListSortingStrategy}
          >
            {page.blocks.map((block) => (
              <SortableBlock
                key={block._id}
                block={block}
                isSelected={focusedBlockId === block._id}
              />
            ))}
          </SortableContext>
        </DndContext>
        {afterBlocks.map((block) => (
          <LayoutBlockItem
            key={block._id}
            block={block}
            isSelected={focusedBlockId === block._id}
            layoutName={layout?.title ?? "Unknown"}
          />
        ))}
      </div>
      <Button
        variant="secondary"
        onClick={() =>
          previewStore.send({
            type: "openAddBlockSheet",
          })
        }
      >
        <Plus />
        Add block
      </Button>
    </>
  );
};

export { PageTree };
