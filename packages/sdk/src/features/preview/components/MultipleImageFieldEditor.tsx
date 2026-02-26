import * as React from "react";
import { useMutation } from "convex/react";
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
import { GripVertical, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FileUpload, type FileRef } from "@/components/file-upload";
import { cn } from "@/lib/utils";
import { api } from "camox/_generated/api";
import type { Doc, Id } from "camox/_generated/dataModel";
import { ImageLightbox } from "./ImageLightbox";

/* -------------------------------------------------------------------------------------------------
 * SortableImageItem
 * -----------------------------------------------------------------------------------------------*/

interface SortableImageItemProps {
  item: Doc<"repeatableItems">;
  onRemove: (itemId: Id<"repeatableItems">) => void;
  onImageOpen: (item: Doc<"repeatableItems">) => void;
}

const SortableImageItem = ({
  item,
  onRemove,
  onImageOpen,
}: SortableImageItemProps) => {
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

  const image = item.content?.image as
    | { url: string; alt: string; filename: string }
    | undefined;

  const url = image?.url ?? "";
  const alt = image?.alt ?? "";
  const filename = image?.filename ?? "Untitled";

  return (
    <li>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex flex-row items-center gap-2 px-1 py-1 max-w-full rounded-lg text-foreground transition-none group",
          !isDragging && "hover:bg-accent/75",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>

        <button
          type="button"
          className="flex flex-1 items-center gap-2 min-w-0 cursor-zoom-in"
          onClick={() => onImageOpen(item)}
        >
          <div className="w-12 h-12 rounded border border-border overflow-hidden shrink-0">
            <img
              src={url}
              alt={alt || filename}
              className="w-full h-full object-cover"
            />
          </div>

          <p className="flex-1 truncate text-sm text-left" title={filename}>
            {filename}
          </p>
        </button>

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
          <X className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
};

/* -------------------------------------------------------------------------------------------------
 * MultipleImageFieldEditor
 * -----------------------------------------------------------------------------------------------*/

interface MultipleImageFieldEditorProps {
  imageFieldName: string;
  currentData: Record<string, unknown>;
  blockId: Id<"blocks">;
}

const MultipleImageFieldEditor = ({
  imageFieldName,
  currentData,
  blockId,
}: MultipleImageFieldEditorProps) => {
  const { pathname } = useLocation();

  const createItemMutation = useMutation(
    api.repeatableItems.createRepeatableItem,
  );
  const deleteItemMutation = useMutation(
    api.repeatableItems.deleteRepeatableItem,
  );
  const updatePositionMutation = useMutation(
    api.repeatableItems.updateRepeatableItemPosition,
  ).withOptimisticUpdate((localStore, args) => {
    const currentPage = localStore.getQuery(api.pages.getPage, {
      fullPath: pathname,
    });

    if (!currentPage) return;

    const updatedBlocks = currentPage.blocks.map((block) => {
      const hasItemInAnyField = Object.entries(block.content).some(
        ([_, value]) => {
          if (Array.isArray(value)) {
            return value.some((item) => item._id === args.itemId);
          }
          return false;
        },
      );

      if (!hasItemInAnyField) return block;

      const updatedContent = { ...block.content };

      for (const [fieldName, fieldValue] of Object.entries(block.content)) {
        if (!Array.isArray(fieldValue)) continue;

        const items = fieldValue as Doc<"repeatableItems">[];
        const itemIndex = items.findIndex((item) => item._id === args.itemId);

        if (itemIndex === -1) continue;

        const item = items[itemIndex];
        const newPosition = generateKeyBetween(
          args.afterPosition ?? null,
          args.beforePosition ?? null,
        );

        const updatedItem = { ...item, position: newPosition };
        const newItems = [...items];
        newItems[itemIndex] = updatedItem;

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

    localStore.setQuery(
      api.pages.getPage,
      { fullPath: pathname },
      { ...currentPage, blocks: updatedBlocks },
    );
  });

  const allItems = (currentData[imageFieldName] ??
    []) as Doc<"repeatableItems">[];

  const items = allItems.filter((item) => {
    const image = item.content?.image as { url?: string } | undefined;
    return image?.url && !image.url.includes("placehold.co");
  });

  // Lightbox state
  const [lightboxItem, setLightboxItem] =
    React.useState<Doc<"repeatableItems"> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const dbItems = items;
    const oldIndex = dbItems.findIndex((item) => item._id === active.id);
    const newIndex = dbItems.findIndex((item) => item._id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    let afterPosition: string | undefined;
    let beforePosition: string | undefined;

    if (oldIndex < newIndex) {
      afterPosition = dbItems[newIndex].position;
      beforePosition =
        newIndex < dbItems.length - 1
          ? dbItems[newIndex + 1].position
          : undefined;
    } else {
      afterPosition = newIndex > 0 ? dbItems[newIndex - 1].position : undefined;
      beforePosition = dbItems[newIndex].position;
    }

    await updatePositionMutation({
      itemId: active.id as Id<"repeatableItems">,
      afterPosition,
      beforePosition,
    });
  };

  const handleRemove = (itemId: Id<"repeatableItems">) => {
    deleteItemMutation({ itemId });
  };

  const handleUploadComplete = (ref: FileRef) => {
    createItemMutation({
      blockId,
      fieldName: imageFieldName,
      content: { image: ref },
    });
  };

  const handleImageOpen = (item: Doc<"repeatableItems">) => {
    setLightboxItem(item);
  };

  return (
    <div className="py-4 px-4 space-y-4">
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
                <SortableImageItem
                  key={item._id}
                  item={item}
                  onRemove={handleRemove}
                  onImageOpen={handleImageOpen}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <FileUpload
        multiple
        hidePreview
        onUploadComplete={handleUploadComplete}
      />

      {(() => {
        const image = lightboxItem?.content?.image as
          | { _fileId?: string }
          | undefined;
        if (!image?._fileId) return null;
        return (
          <ImageLightbox
            open={!!lightboxItem}
            onOpenChange={(open) => {
              if (!open) setLightboxItem(null);
            }}
            fileId={image._fileId as Id<"files">}
          />
        );
      })()}
    </div>
  );
};

export { MultipleImageFieldEditor };
