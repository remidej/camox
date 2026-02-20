import { useMutation } from "convex/react";
import { useSelector } from "@xstate/store/react";
import { useLocation } from "@tanstack/react-router";
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
import { CircleMinus, CirclePlus, GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "camox/_generated/api";
import { Doc, Id } from "camox/_generated/dataModel";
import { previewStore } from "../previewStore";
import type { OverlayMessage } from "../overlayMessages";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* -------------------------------------------------------------------------------------------------
 * SortableRepeatableItem
 * -----------------------------------------------------------------------------------------------*/

interface SortableRepeatableItemProps {
  item: Doc<"repeatableItems">;
  blockId: Id<"blocks">;
  fieldName: string;
  canRemove: boolean;
  onRemove: (itemId: Id<"repeatableItems">) => void;
}

const SortableRepeatableItem = ({
  item,
  blockId,
  fieldName,
  canRemove,
  onRemove,
}: SortableRepeatableItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Check if this item is currently selected
  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  const iframeElement = useSelector(
    previewStore,
    (state) => state.context.iframeElement,
  );
  const isSelected = selectionBreadcrumbs.some(
    (b) => b.type === "RepeatableObject" && b.id === item._id,
  );

  const shouldShowHover = !isDragging && !isSelected;

  const handleMouseEnter = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_REPEATER_ITEM",
      blockId,
      itemId: item._id,
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  const handleMouseLeave = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_REPEATER_ITEM_END",
      blockId,
      itemId: item._id,
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  return (
    <li>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex flex-row justify-between items-center gap-2 px-1 py-1 max-w-full rounded-lg text-foreground transition-none group",
          shouldShowHover && "hover:bg-accent/75",
          isSelected && "bg-accent text-accent-foreground",
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1 flex-1 overflow-x-hidden">
          <p
            className="cursor-default flex-1 truncate py-1 text-sm"
            title={item.summary}
            onClick={() => {
              // Clear hover overlay before unmounting — mouseLeave won't fire
              handleMouseLeave();
              previewStore.send({
                type: "drillIntoRepeatableItem",
                itemId: item._id,
                fieldName,
              });
            }}
          >
            {item.summary}
          </p>
        </div>

        {canRemove && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hidden group-hover:flex group-focus-within:flex text-muted-foreground hover:text-foreground shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item._id);
                }}
              >
                <CircleMinus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Remove item</TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
};

/* -------------------------------------------------------------------------------------------------
 * RepeatableItemsList
 * -----------------------------------------------------------------------------------------------*/

interface RepeatableItemsListProps {
  items: Doc<"repeatableItems">[];
  blockId: Id<"blocks">;
  fieldName: string;
  minItems?: number;
  maxItems?: number;
  schema: unknown;
}

const RepeatableItemsList = ({
  items,
  blockId,
  fieldName,
  minItems,
  maxItems,
  schema,
}: RepeatableItemsListProps) => {
  const { pathname } = useLocation();
  const updatePositionMutation = useMutation(
    api.repeatableItems.updateRepeatableItemPosition,
  ).withOptimisticUpdate((localStore, args) => {
    // Get the current page data
    const currentPage = localStore.getQuery(api.pages.getPage, {
      fullPath: pathname,
    });

    if (!currentPage) return;

    // Find the block containing this item
    const updatedBlocks = currentPage.blocks.map((block) => {
      // Check if this block contains the item being moved
      const hasItemInAnyField = Object.entries(block.content).some(
        ([_, value]) => {
          if (Array.isArray(value)) {
            return value.some((item) => item._id === args.itemId);
          }
          return false;
        },
      );

      if (!hasItemInAnyField) return block;

      // Update the block's content
      const updatedContent = { ...block.content };

      for (const [fieldName, fieldValue] of Object.entries(block.content)) {
        if (!Array.isArray(fieldValue)) continue;

        const items = fieldValue as Doc<"repeatableItems">[];
        const itemIndex = items.findIndex((item) => item._id === args.itemId);

        if (itemIndex === -1) continue;

        // Found the field with the item - reorder it
        const item = items[itemIndex];

        // Calculate the new position
        const newPosition = generateKeyBetween(
          args.afterPosition ?? null,
          args.beforePosition ?? null,
        );

        // Update the item's position
        const updatedItem = { ...item, position: newPosition };

        // Create new array with updated item
        const newItems = [...items];
        newItems[itemIndex] = updatedItem;

        // Re-sort the items by position
        newItems.sort((a, b) => {
          if (a.position < b.position) return -1;
          if (a.position > b.position) return 1;
          return 0;
        });

        updatedContent[fieldName] = newItems;
      }

      return {
        ...block,
        content: updatedContent,
      };
    });

    // Update the page in the local store
    localStore.setQuery(
      api.pages.getPage,
      { fullPath: pathname },
      { ...currentPage, blocks: updatedBlocks },
    );
  });

  const createItemMutation = useMutation(
    api.repeatableItems.createRepeatableItem,
  );
  const deleteItemMutation = useMutation(
    api.repeatableItems.deleteRepeatableItem,
  );

  const canAdd = maxItems === undefined || items.length < maxItems;
  const canRemove = minItems === undefined || items.length > minItems;

  const handleAddItem = () => {
    const defaultContent: Record<string, unknown> = {};
    const itemsSchema = (schema as any)?.items;
    if (itemsSchema?.properties) {
      for (const [key, prop] of Object.entries(itemsSchema.properties)) {
        if ("default" in (prop as any)) {
          defaultContent[key] = (prop as { default: unknown }).default;
        }
      }
    }
    createItemMutation({ blockId, fieldName, content: defaultContent });
  };

  const handleRemoveItem = (itemId: Id<"repeatableItems">) => {
    deleteItemMutation({ itemId });
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // Find the old and new indices
    const oldIndex = items.findIndex((item) => item._id === active.id);
    const newIndex = items.findIndex((item) => item._id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Determine afterPosition and beforePosition based on new index
    // When dragging down (oldIndex < newIndex), the item is inserted after newIndex
    // When dragging up (oldIndex > newIndex), the item is inserted before newIndex
    let afterPosition: string | undefined;
    let beforePosition: string | undefined;

    if (oldIndex < newIndex) {
      // Dragging down: insert after the target position
      afterPosition = items[newIndex].position;
      beforePosition =
        newIndex < items.length - 1 ? items[newIndex + 1].position : undefined;
    } else {
      // Dragging up: insert before the target position
      afterPosition = newIndex > 0 ? items[newIndex - 1].position : undefined;
      beforePosition = items[newIndex].position;
    }

    await updatePositionMutation({
      itemId: active.id as Id<"repeatableItems">,
      afterPosition,
      beforePosition,
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {items.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext
            items={items.map((item) => item._id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <SortableRepeatableItem
                  key={item._id}
                  item={item}
                  blockId={blockId}
                  fieldName={fieldName}
                  canRemove={canRemove}
                  onRemove={handleRemoveItem}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {canAdd && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground justify-start self-start"
          onClick={handleAddItem}
        >
          <CirclePlus className="h-4 w-4" />
          Add item
        </Button>
      )}
    </div>
  );
};

export { RepeatableItemsList };
