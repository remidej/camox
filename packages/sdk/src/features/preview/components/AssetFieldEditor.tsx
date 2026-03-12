import type { Doc, Id } from "camox/_generated/dataModel";
import { FileIcon, Upload } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { UploadDropZone } from "@/features/content/components/UploadDropZone";
import { UploadItemRow } from "@/features/content/components/UploadProgressDrawer";
import { type UploadItem, useFileUpload } from "@/hooks/use-file-upload";

import { AssetLightbox } from "./AssetLightbox";
import { AssetPickerGrid } from "./AssetPickerGrid";
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
}: {
  isImage: boolean;
  multiple: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickerOpen: () => void;
  onFilesSelected: (files: FileList) => void;
  uploads: UploadItem[];
}) => (
  <>
    <Button variant="default" className="mx-auto flex w-full" onClick={onPickerOpen}>
      Select existing {assetLabel(isImage, multiple)}
    </Button>
    <Button
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
      accept={isImage ? "image/*" : "*/*"}
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
}: {
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
        _fileId?: string;
      }
    | undefined;

  const hasAsset = !!asset?.url;
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const isImage = assetType === "Image";
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { uploads, uploadFiles } = useFileUpload({
    onFileCommitted: (result) => {
      onFieldChange(fieldName, {
        url: result.url,
        alt: "",
        filename: result.filename,
        mimeType: result.mimeType,
        _fileId: result.fileId,
      });
    },
  });

  const handleDrop = React.useCallback(
    (files: FileList) => {
      // Single-file field: only upload the first file
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      uploadFiles(dt.files);
    },
    [uploadFiles],
  );

  const handleSelectExisting = (file: Doc<"files">) => {
    onFieldChange(fieldName, {
      url: file.url,
      alt: file.alt,
      filename: file.filename,
      mimeType: file.mimeType,
      _fileId: file._id,
    });
    setPickerOpen(false);
  };

  return (
    <UploadDropZone onDrop={handleDrop}>
      {pickerOpen ? (
        <AssetPickerGrid
          assetType={assetType}
          mode="single"
          onSelectSingle={handleSelectExisting}
          onSelectMultiple={() => {}}
          onClose={() => setPickerOpen(false)}
        />
      ) : (
        <div className="space-y-4 px-4 py-4">
          {hasAsset && (
            <div className="text-foreground hover:bg-accent/75 flex max-w-full flex-row items-center gap-2 rounded-lg border-2 px-1 py-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-zoom-in items-center gap-2"
                onClick={() => setLightboxOpen(true)}
              >
                {isImage ? (
                  <div className="border-border h-10 w-10 shrink-0 overflow-hidden rounded border">
                    <img
                      src={asset.url}
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
                fileId={asset._fileId as Id<"files"> | undefined}
                onUnlink={() => {
                  onFieldChange(fieldName, {
                    url: "",
                    alt: "",
                    filename: "",
                    mimeType: "",
                  });
                }}
              />
              {asset._fileId && (
                <AssetLightbox
                  open={lightboxOpen}
                  onOpenChange={setLightboxOpen}
                  fileId={asset._fileId as Id<"files">}
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
          />
        </div>
      )}
    </UploadDropZone>
  );
};

export { AssetActionButtons, SingleAssetFieldEditor };
