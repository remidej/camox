import * as React from "react";
import { FileIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/file-upload";
import type { Id } from "camox/_generated/dataModel";
import { AssetLightbox } from "./AssetLightbox";

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
  const isImage = assetType === "Image";

  return (
    <div className="py-4 px-4 space-y-4">
      {hasAsset && (
        <div className="flex flex-row items-center gap-2 px-1 py-1 max-w-full rounded-lg text-foreground hover:bg-accent/75 border-2">
          <button
            type="button"
            className="flex flex-1 items-center gap-2 min-w-0 cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
          >
            {isImage ? (
              <div className="w-10 h-10 rounded border border-border overflow-hidden shrink-0">
                <img
                  src={asset.url}
                  alt={asset.alt || asset.filename}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-10 h-10 rounded border border-border overflow-hidden shrink-0 flex items-center justify-center bg-muted">
                <FileIcon className="h-5 w-5 text-muted-foreground" />
              </div>
            )}

            <p
              className="flex-1 truncate text-sm text-left"
              title={asset.filename}
            >
              {asset.filename || "Untitled"}
            </p>
          </button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => {
              onFieldChange(fieldName, {
                url: "",
                alt: "",
                filename: "",
                mimeType: "",
              });
            }}
          >
            <X className="h-4 w-4" />
          </Button>

          {asset._fileId && (
            <AssetLightbox
              open={lightboxOpen}
              onOpenChange={setLightboxOpen}
              fileId={asset._fileId as Id<"files">}
            />
          )}
        </div>
      )}

      <FileUpload
        initialValue={asset}
        hidePreview
        accept={isImage ? "image/*" : "*/*"}
        onUploadComplete={(ref) => {
          onFieldChange(fieldName, ref);
        }}
        onClear={() => {
          onFieldChange(fieldName, {
            url: "",
            alt: "",
            filename: "",
            mimeType: "",
          });
        }}
      />
    </div>
  );
};

export { SingleAssetFieldEditor };
