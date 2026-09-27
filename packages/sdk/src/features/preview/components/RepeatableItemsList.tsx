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
import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { CircleMinus, CirclePlus, GripVertical } from "lucide-react";
import { useContext } from "react";

import { repeatableItemMutations } from "@/lib/queries";
import { cn } from "@/lib/utils";

import type { OverlayMessage } from "../overlayMessages";
import { PreviewEditingOwnerContext, usePreviewTargetSelection } from "../previewSelection";
import { previewStore, selectionItemId } from "../previewStore";
import { useRepeatableItemActions, type RepeatableArraySchema } from "./useRepeatableItemActions";

/* -------------------------------------------------------------------------------------------------
 * SortableRepeatableItem
 * -----------------------------------------------------------------------------------------------*/

type RepeatableItem = {
  id: number;
  summary: string;
  position: string;
  content: Record<string, unknown>;
};

interface SortableRepeatableItemProps {
  item: RepeatableItem;
  blockId: number;
  fieldName: string;
  canRemove: boolean;
  onRemove: (itemId: number) => void;
}

const SortableRepeatableItem = ({
  item,
  fieldName,
  blockId,
  canRemove,
  onRemove,
}: SortableRepeatableItemProps) => {
  const owner = useContext(PreviewEditingOwnerContext);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(item.id),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Check if this item is currently selected
  const isSelected = selectionItemId(usePreviewTargetSelection()) === item.id;

  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);

  const shouldShowHover = !isDragging && !isSelected;

  const handleMouseEnter = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_REPEATER_ITEM",
      blockId: String(blockId),
      itemId: String(item.id),
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  const handleMouseLeave = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_REPEATER_ITEM_END",
      blockId: String(blockId),
      itemId: String(item.id),
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
          className="text-muted-foreground hover:text-foreground flex cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>

        <div className="flex flex-1 items-center gap-1 overflow-x-hidden">
          <p
            className="flex-1 cursor-default truncate py-1 text-sm"
            title={item.summary}
            onClick={() => {
              if (owner === null) return;
              // Clear hover overlay before unmounting — mouseLeave won't fire
              handleMouseLeave();
              previewStore.send({
                type: "selectItem",
                ...owner,
                blockId,
                itemId: item.id,
              });
            }}
          >
            {item.summary || `${fieldName} (${item.id})`}
          </p>
        </div>

        {canRemove && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground hidden shrink-0 group-focus-within:flex group-hover:flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                />
              }
            >
              <CircleMinus className="h-4 w-4" />
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
  items: RepeatableItem[];
  blockId: number;
  fieldName: string;
  schema: unknown;
}

const RepeatableItemsList = ({ items, blockId, fieldName, schema }: RepeatableItemsListProps) => {
  const updateRepeatablePosition = useMutation(repeatableItemMutations.updatePosition());

  const { canAdd, addItem, canRemove, removeItem } = useRepeatableItemActions({
    blockId,
    fieldName,
    arraySchema: schema as RepeatableArraySchema | null,
    siblingCount: items.length,
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => String(item.id) === active.id);
    const newIndex = items.findIndex((item) => String(item.id) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    let afterPosition: string | undefined;
    let beforePosition: string | undefined;

    if (oldIndex < newIndex) {
      afterPosition = items[newIndex].position;
      beforePosition = newIndex < items.length - 1 ? items[newIndex + 1].position : undefined;
    } else {
      afterPosition = newIndex > 0 ? items[newIndex - 1].position : undefined;
      beforePosition = items[newIndex].position;
    }

    await updateRepeatablePosition.mutateAsync({
      id: Number(active.id),
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
            items={items.map((item) => String(item.id))}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <SortableRepeatableItem
                  key={String(item.id)}
                  item={item}
                  blockId={blockId}
                  fieldName={fieldName}
                  canRemove={canRemove}
                  onRemove={removeItem}
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
          onClick={() => addItem()}
        >
          <CirclePlus className="h-4 w-4" />
          Add item
        </Button>
      )}
    </div>
  );
};

export { RepeatableItemsList };
