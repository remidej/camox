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
import { FileIcon, GripVertical, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FileUpload, type FileRef } from "@/components/file-upload";
import { cn } from "@/lib/utils";
import { api } from "camox/_generated/api";
import type { Doc, Id } from "camox/_generated/dataModel";
import { AssetLightbox } from "./AssetLightbox";

/* -------------------------------------------------------------------------------------------------
 * SortableAssetItem
 * -----------------------------------------------------------------------------------------------*/

interface SortableAssetItemProps {
  item: Doc<"repeatableItems">;
  assetType: "Image" | "File";
  contentKey: "image" | "file";
  onRemove: (itemId: Id<"repeatableItems">) => void;
  onAssetOpen: (item: Doc<"repeatableItems">) => void;
}

const SortableAssetItem = ({
  item,
  assetType,
  contentKey,
  onRemove,
  onAssetOpen,
}: SortableAssetItemProps) => {
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

  const asset = item.content?.[contentKey] as
    | { url: string; alt: string; filename: string }
    | undefined;

  const url = asset?.url ?? "";
  const alt = asset?.alt ?? "";
  const filename = asset?.filename ?? "Untitled";

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
          onClick={() => onAssetOpen(item)}
        >
          {assetType === "Image" ? (
            <div className="w-12 h-12 rounded border border-border overflow-hidden shrink-0">
              <img
                src={url}
                alt={alt || filename}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-12 h-12 rounded border border-border overflow-hidden shrink-0 flex items-center justify-center bg-muted">
              <FileIcon className="h-6 w-6 text-muted-foreground" />
            </div>
          )}

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
 * MultipleAssetFieldEditor
 * -----------------------------------------------------------------------------------------------*/

interface MultipleAssetFieldEditorProps {
  fieldName: string;
  assetType: "Image" | "File";
  currentData: Record<string, unknown>;
  blockId: Id<"blocks">;
}

const MultipleAssetFieldEditor = ({
  fieldName,
  assetType,
  currentData,
  blockId,
}: MultipleAssetFieldEditorProps) => {
  const { pathname } = useLocation();
  const contentKey = assetType === "Image" ? "image" : "file";

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

  const allItems = (currentData[fieldName] ??
    []) as Doc<"repeatableItems">[];

  const items = allItems.filter((item) => {
    const asset = item.content?.[contentKey] as { url?: string } | undefined;
    return asset?.url && !asset.url.includes("placehold.co");
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
      fieldName,
      content: { [contentKey]: ref },
    });
  };

  const handleAssetOpen = (item: Doc<"repeatableItems">) => {
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
                <SortableAssetItem
                  key={item._id}
                  item={item}
                  assetType={assetType}
                  contentKey={contentKey}
                  onRemove={handleRemove}
                  onAssetOpen={handleAssetOpen}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <FileUpload
        multiple
        hidePreview
        accept={assetType === "Image" ? "image/*" : "*/*"}
        onUploadComplete={handleUploadComplete}
      />

      {(() => {
        const asset = lightboxItem?.content?.[contentKey] as
          | { _fileId?: string }
          | undefined;
        if (!asset?._fileId) return null;
        return (
          <AssetLightbox
            open={!!lightboxItem}
            onOpenChange={(open) => {
              if (!open) setLightboxItem(null);
            }}
            fileId={asset._fileId as Id<"files">}
          />
        );
      })()}
    </div>
  );
};

export { MultipleAssetFieldEditor };
