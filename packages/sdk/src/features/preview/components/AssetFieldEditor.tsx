import { Button } from "@camox/ui/button";
import { useQuery } from "@tanstack/react-query";
import { FileIcon, Upload } from "lucide-react";
import * as React from "react";

import { transformImageUrl } from "@/core/lib/imageTransform";
import { UploadDropZone } from "@/features/content/components/UploadDropZone";
import { UploadItemRow } from "@/features/content/components/UploadProgressDrawer";
import { type UploadItem, useFileUpload } from "@/hooks/use-file-upload";
import { useProjectSlug } from "@/lib/auth";
import { type File, projectQueries } from "@/lib/queries";

import { AssetLightbox } from "./AssetLightbox";
import { AssetPickerModal } from "./AssetPickerModal";
import { UnlinkAssetButton } from "./UnlinkAssetButton";

function assetLabel(isImage: boolean, multiple: boolean) {
  if (isImage) return multiple ? "images" : "image";
  return multiple ? "files" : "file";
}

/* -------------------------------------------------------------------------------------------------
 * AssetActionButtons
 * -----------------------------------------------------------------------------------------------*/

const AssetActionButtons = ({
  isImage,
  multiple,
  fileInputRef,
  onPickerOpen,
  onFilesSelected,
  uploads,
  accept,
}: {
  isImage: boolean;
  multiple: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickerOpen: () => void;
  onFilesSelected: (files: FileList) => void;
  uploads: UploadItem[];
  accept?: string[];
}) => (
  <>
    <Button type="button" variant="default" className="mx-auto flex w-full" onClick={onPickerOpen}>
      Select existing {assetLabel(isImage, multiple)}
    </Button>
    <Button
      type="button"
      variant="secondary"
      className="mx-auto flex w-full"
      onClick={() => fileInputRef.current?.click()}
    >
      <Upload className="h-4 w-4" />
      Upload new
    </Button>
    <p className="text-muted-foreground text-center text-xs">Or drag anywhere to upload</p>
    <input
      type="file"
      ref={fileInputRef}
      className="hidden"
      accept={accept?.join(",") ?? (isImage ? "image/*" : "*/*")}
      multiple={multiple}
      onChange={(e) => {
        if (e.target.files) onFilesSelected(e.target.files);
        e.target.value = "";
      }}
    />
    {uploads.length > 0 && (
      <div>
        {uploads.map((item) => (
          <UploadItemRow key={item.id} item={item} />
        ))}
      </div>
    )}
  </>
);

/* -------------------------------------------------------------------------------------------------
 * SingleAssetFieldEditor
 * -----------------------------------------------------------------------------------------------*/

const SingleAssetFieldEditor = ({
  fieldName,
  assetType,
  currentData,
  onFieldChange,
  resolveLocally = false,
  accept,
}: {
  resolveLocally?: boolean;
  accept?: string[];
  fieldName: string;
  assetType: "Image" | "File";
  currentData: Record<string, unknown>;
  onFieldChange: (fieldName: string, value: unknown) => void;
}) => {
  const asset = currentData[fieldName] as
    | {
        url: string;
        alt: string;
        filename: string;
        mimeType: string;
        size?: number;
        _fileId?: string;
      }
    | undefined;

  const hasAsset = !!asset?.url;
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const isImage = assetType === "Image";
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));

  const { uploads, uploadFiles } = useFileUpload({
    projectId: project?.id,
    onFileCommitted: (result) => {
      onFieldChange(fieldName, {
        ...(resolveLocally ? { ...result, alt: "" } : {}),
        _fileId: Number(result.fileId),
      });
    },
  });

  const handleDrop = React.useCallback(
    (files: FileList) => {
      if (!files.length) return;
      // Single-file field: only upload the first file
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      uploadFiles(dt.files);
    },
    [uploadFiles],
  );

  const handleSelectExisting = (file: File) => {
    onFieldChange(fieldName, {
      ...(resolveLocally ? file : {}),
      _fileId: file.id,
    });
    setPickerOpen(false);
  };

  return (
    <UploadDropZone onDrop={handleDrop}>
      <div className="space-y-4 px-2 py-4">
        {hasAsset && (
          <div className="text-foreground hover:bg-accent/75 flex max-w-full flex-row items-center gap-2 rounded-lg border-2 px-1 py-1">
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-zoom-in items-center gap-2 rounded-sm p-1"
              onClick={() => setLightboxOpen(true)}
            >
              {isImage ? (
                <div className="border-border h-10 w-10 shrink-0 overflow-hidden rounded border">
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
                <div className="border-border bg-muted flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border">
                  <FileIcon className="text-muted-foreground h-5 w-5" />
                </div>
              )}

              <p className="flex-1 truncate text-left text-sm" title={asset.filename}>
                {asset.filename || "Untitled"}
              </p>
            </button>
            <UnlinkAssetButton
              fileId={asset._fileId != null ? Number(asset._fileId) : undefined}
              persisted={!resolveLocally}
              onUnlink={() => {
                onFieldChange(fieldName, null);
              }}
            />
            {asset._fileId && (
              <AssetLightbox
                open={lightboxOpen}
                onOpenChange={setLightboxOpen}
                fileId={Number(asset._fileId)}
              />
            )}
          </div>
        )}
        <AssetActionButtons
          isImage={isImage}
          multiple={false}
          fileInputRef={fileInputRef}
          onPickerOpen={() => setPickerOpen(true)}
          onFilesSelected={handleDrop}
          uploads={uploads}
          accept={accept}
        />
      </div>
      <AssetPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType={assetType}
        mode="single"
        onSelectSingle={handleSelectExisting}
        onSelectMultiple={() => {}}
      />
    </UploadDropZone>
  );
};

export { AssetActionButtons, SingleAssetFieldEditor };
