import * as React from "react";
import { useMutation } from "convex/react";
import * as Accordion from "@radix-ui/react-accordion";
import { Ellipsis, GripVertical, Plus, Type } from "lucide-react";
import { useSelector } from "@xstate/store/react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { generateKeyBetween } from "fractional-indexing";

import { Button } from "@/components/ui/button";
import { previewStore } from "../previewStore";
import type { OverlayMessage } from "../overlayMessages";
import { api } from "camox/_generated/api";
import { Doc, Id } from "camox/_generated/dataModel";
import { cn } from "@/lib/utils";
import { PanelContent } from "@/components/ui/panel";
import { usePreviewedPage } from "../CamoxPreview";
import { useLocation } from "@tanstack/react-router";
import { BlockActionsPopover } from "./BlockActionsPopover";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { fieldTypesDictionary } from "@/core/lib/fieldTypes";

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
  isSelected,
  onFieldClick,
  onFieldDoubleClick,
  onMouseEnter,
  onMouseLeave,
}: FieldItemProps) => {
  const embedUrl = fieldType === "Embed" ? (value as string) : null;
  const fetchedEmbedTitle = useEmbedTitle(embedUrl);

  const fieldDef =
    fieldType != null
      ? fieldTypesDictionary[fieldType as keyof typeof fieldTypesDictionary]
      : null;
  const displayValue = fieldDef
    ? fieldDef.getLabel(value, {
        schemaTitle,
        fieldName,
        fetchedTitle: fetchedEmbedTitle,
      })
    : JSON.stringify(value);

  const FieldIcon = fieldDef?.Icon ?? Type;

  return (
    <li
      className={cn(
        "flex items-center gap-1.5 rounded-lg pl-2 pr-1 py-2 cursor-default group/field",
        isSelected ? "bg-accent" : "hover:bg-accent/50",
      )}
      onClick={() => fieldType && onFieldClick()}
      onDoubleClick={() => fieldType && onFieldDoubleClick()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <FieldIcon className="size-4 shrink-0" />
      <span className="text-accent-foreground select-none truncate">
        {displayValue}
      </span>
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
  const iframeElement = useSelector(
    previewStore,
    (state) => state.context.iframeElement,
  );

  // Check if a field is selected (breadcrumbs has block + field)
  const selectedFieldName =
    selectionBreadcrumbs.length === 2 &&
    selectionBreadcrumbs[0]?.id === block._id
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
    if (fieldType === "RepeatableObject") {
      previewStore.send({
        type: "setFocusedBlock",
        blockId: block._id,
      });
    } else {
      previewStore.send({
        type: "setSelectedField",
        blockId: block._id,
        fieldName,
        fieldType: fieldType as "String" | "RepeatableObject",
      });
    }
    previewStore.send({
      type: "openBlockContentSheet",
      blockId: block._id,
    });
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
    <ul className="pl-7 pr-1 my-1 space-y-1">
      {Object.entries(block.content).map(([fieldName, value]) => {
        const fieldSchema = schemaProperties?.[fieldName];
        const fieldType = fieldSchema?.fieldType;
        const isRepeatable = fieldType === "RepeatableObject";
        return (
          <FieldItem
            key={fieldName}
            fieldName={fieldName}
            value={value}
            fieldType={fieldType}
            schemaTitle={fieldSchema?.title}
            isSelected={selectedFieldName === fieldName}
            onFieldClick={() => handleFieldClick(fieldName, fieldType!)}
            onFieldDoubleClick={() =>
              handleFieldDoubleClick(fieldName, fieldType!)
            }
            onMouseEnter={() => handleFieldMouseEnter(fieldName, isRepeatable)}
            onMouseLeave={() => handleFieldMouseLeave(fieldName, isRepeatable)}
          />
        );
      })}
    </ul>
  );
};

/* -------------------------------------------------------------------------------------------------
 * SortableBlock
 * -----------------------------------------------------------------------------------------------*/

interface SortableBlockProps {
  block: Doc<"blocks">;
  isSelected: boolean;
}

const SortableBlock = ({ block, isSelected }: SortableBlockProps) => {
  const [gripPopoverOpen, setGripPopoverOpen] = React.useState(false);
  const [ellipsisPopoverOpen, setEllipsisPopoverOpen] = React.useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  const iframeElement = useSelector(
    previewStore,
    (state) => state.context.iframeElement,
  );
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

  return (
    <Accordion.Root
      type="single"
      collapsible
      value={isSelected ? block._id : ""}
      onMouseEnter={handleBlockMouseEnter}
      onMouseLeave={handleBlockMouseLeave}
    >
      <Accordion.Item
        value={block._id}
        ref={setNodeRef}
        style={style}
        className="group"
      >
        <Accordion.Header asChild>
          <div
            className={cn(
              "flex flex-row justify-between items-center gap-1 px-1 max-w-full rounded-lg text-foreground transition-all hover:transition-none",
              shouldShowHover && "hover:bg-accent/50",
              shouldShowActive && "bg-accent text-accent-foreground",
              isParentOfSelection && "bg-accent/25",
              "data-[state=open]:rounded-b-none",
            )}
          >
            <BlockActionsPopover
              block={block}
              open={gripPopoverOpen}
              onOpenChange={setGripPopoverOpen}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex"
                {...attributes}
                {...listeners}
              >
                <span className="sr-only">
                  Click and use arrow keys to reorder
                </span>
                <GripVertical className="h-4 w-4" />
              </Button>
            </BlockActionsPopover>
            <div className="flex items-center gap-1 flex-1 overflow-x-hidden">
              <Accordion.Trigger asChild>
                <button
                  className={cn(
                    "cursor-default flex-1 truncate py-2 text-sm text-left rounded-sm",
                    "focus-visible:underline outline-none focus-visible:decoration-ring/50 focus-visible:decoration-4",
                  )}
                  title={block.summary}
                  onClick={() => {
                    if (isSelected) {
                      previewStore.send({ type: "clearSelection" });
                    } else {
                      previewStore.send({
                        type: "setFocusedBlock",
                        blockId: block._id,
                      });
                    }
                  }}
                >
                  {block.summary}
                </button>
              </Accordion.Trigger>
            </div>
            <BlockActionsPopover
              block={block}
              open={ellipsisPopoverOpen}
              onOpenChange={setEllipsisPopoverOpen}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  ellipsisPopoverOpen
                    ? "flex"
                    : "hidden group-hover:flex group-focus-within:flex",
                )}
              >
                <Ellipsis className="size-4" />
              </Button>
            </BlockActionsPopover>
          </div>
        </Accordion.Header>
        <Accordion.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm text-muted-foreground rounded-b-lg data-[state=open]:bg-accent/25">
          <BlockFields block={block} />
        </Accordion.Content>
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

  const updatePositionMutation = useMutation(
    api.blocks.updateBlockPosition,
  ).withOptimisticUpdate((localStore, args) => {
    // Get the current page data
    const currentPage = localStore.getQuery(api.pages.getPage, {
      fullPath: pathname,
    });

    if (!currentPage) return;

    // Find the block being moved
    const blockIndex = currentPage.blocks.findIndex(
      (block) => block._id === args.blockId,
    );

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
  });

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
        newIndex < page.blocks.length - 1
          ? page.blocks[newIndex + 1].position
          : undefined;
    } else {
      // Dragging up: insert before the target position
      afterPosition =
        newIndex > 0 ? page.blocks[newIndex - 1].position : undefined;
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

  return (
    <PanelContent className="grow basis-0 flex flex-col gap-2 p-2 overflow-auto">
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
          <div className="flex flex-col gap-0.5">
            {page.blocks.map((block) => (
              <SortableBlock
                key={block._id}
                block={block}
                isSelected={focusedBlockId === block._id}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        variant="outline"
        onClick={() =>
          previewStore.send({
            type: "openAddBlockSheet",
          })
        }
      >
        <Plus />
        Add block
      </Button>
    </PanelContent>
  );
};

export { PageTree };
