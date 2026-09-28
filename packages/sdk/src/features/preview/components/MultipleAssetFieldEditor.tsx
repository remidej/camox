import { Button } from "@camox/ui/button";
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
import { useQuery } from "@tanstack/react-query";
import { FileIcon, GripVertical } from "lucide-react";
import * as React from "react";

import { transformImageUrl } from "@/core/lib/imageTransform";
import { UploadDropZone } from "@/features/content/components/UploadDropZone";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useProjectSlug } from "@/lib/auth";
import { type File, projectQueries } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { AssetActionButtons } from "./AssetFieldEditor";
import { AssetLightbox } from "./AssetLightbox";
import { AssetPickerModal } from "./AssetPickerModal";
import { UnlinkAssetButton } from "./UnlinkAssetButton";

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

type ResolvedAsset = {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size?: number;
  _fileId: number;
};

/* -------------------------------------------------------------------------------------------------
 * SortableAssetItem
 * -----------------------------------------------------------------------------------------------*/

interface SortableAssetItemProps {
  asset: ResolvedAsset;
  assetType: "Image" | "File";
  onRemove: (fileId: number) => void;
  onAssetOpen: (asset: ResolvedAsset) => void;
  persisted: boolean;
}

const SortableAssetItem = ({
  asset,
  assetType,
  onRemove,
  onAssetOpen,
  persisted,
}: SortableAssetItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(asset._fileId),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

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
          className="text-muted-foreground hover:text-foreground flex shrink-0 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>

        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-zoom-in items-center gap-2"
          onClick={() => onAssetOpen(asset)}
        >
          {assetType === "Image" ? (
            <div className="border-border h-12 w-12 shrink-0 overflow-hidden rounded border">
              <img
                src={transformImageUrl(asset.url, {
                  width: 128,
                  mimeType: asset.mimeType,
                  size: asset.size,
                })}
                alt={asset.alt || asset.filename}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="border-border bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border">
              <FileIcon className="text-muted-foreground h-6 w-6" />
            </div>
          )}

          <p className="flex-1 truncate text-left text-sm" title={asset.filename}>
            {asset.filename || "Untitled"}
          </p>
        </button>

        <UnlinkAssetButton
          fileId={asset._fileId}
          persisted={persisted}
          onUnlink={() => onRemove(asset._fileId)}
          className="hidden group-focus-within:flex group-hover:flex"
        />
      </div>
    </li>
  );
};

/* -------------------------------------------------------------------------------------------------
 * MultipleAssetFieldEditor
 * -----------------------------------------------------------------------------------------------*/

interface MultipleAssetFieldEditorProps {
  resolveLocally?: boolean;
  accept?: string[];
  fieldName: string;
  assetType: "Image" | "File";
  currentData: Record<string, unknown>;
  onFieldChange: (fieldName: string, value: unknown) => void;
}

const MultipleAssetFieldEditor = ({
  fieldName,
  assetType,
  currentData,
  onFieldChange,
  resolveLocally = false,
  accept,
}: MultipleAssetFieldEditorProps) => {
  const isImage = assetType === "Image";
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));

  // Resolved array: [{ url, alt, ..., _fileId }, ...] — flat ImageValue/FileValue
  const items = ((currentData[fieldName] ?? []) as ResolvedAsset[]).filter(
    (a): a is ResolvedAsset => !!a && !!a.url,
  );

  // Keep local form assets resolved; persisted sidebar values use bare references.
  const toStorageFormat = (assets: ResolvedAsset[]) =>
    resolveLocally ? assets : assets.map((a) => ({ _fileId: a._fileId }));
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  const addAssets = (assets: ResolvedAsset[]) => {
    const next = [...itemsRef.current];
    for (const asset of assets) {
      if (!next.some((item) => item._fileId === asset._fileId)) next.push(asset);
    }
    itemsRef.current = next;
    onFieldChange(fieldName, toStorageFormat(next));
  };

  const { uploads, uploadFiles } = useFileUpload({
    projectId: project?.id,
    onFileCommitted: (result) => {
      addAssets([{ ...result, alt: "", _fileId: Number(result.fileId) }]);
    },
  });

  // Picker & lightbox state
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [lightboxAsset, setLightboxAsset] = React.useState<ResolvedAsset | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((a) => String(a._fileId) === active.id);
    const newIndex = items.findIndex((a) => String(a._fileId) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...items];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    onFieldChange(fieldName, toStorageFormat(reordered));
  };

  const handleRemove = (fileId: number) => {
    onFieldChange(fieldName, toStorageFormat(items.filter((a) => a._fileId !== fileId)));
  };

  const handleSelectMultiple = (files: File[]) => {
    addAssets(files.map((file) => ({ ...file, alt: file.alt ?? "", _fileId: file.id })));
    setPickerOpen(false);
  };

  return (
    <UploadDropZone onDrop={uploadFiles}>
      <div className="space-y-4 px-2 py-4">
        {items.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={items.map((a) => String(a._fileId))}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-1">
                {items.map((asset) => (
                  <SortableAssetItem
                    key={asset._fileId}
                    asset={asset}
                    assetType={assetType}
                    onRemove={handleRemove}
                    onAssetOpen={setLightboxAsset}
                    persisted={!resolveLocally}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
        <AssetActionButtons
          isImage={isImage}
          multiple={true}
          fileInputRef={fileInputRef}
          onPickerOpen={() => setPickerOpen(true)}
          onFilesSelected={uploadFiles}
          uploads={uploads}
          accept={accept}
        />
      </div>
      <AssetPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType={assetType}
        mode="multiple"
        onSelectSingle={() => {}}
        onSelectMultiple={handleSelectMultiple}
      />

      {lightboxAsset && (
        <AssetLightbox
          open={!!lightboxAsset}
          onOpenChange={(open) => {
            if (!open) setLightboxAsset(null);
          }}
          fileId={lightboxAsset._fileId}
        />
      )}
    </UploadDropZone>
  );
};

export { MultipleAssetFieldEditor };
