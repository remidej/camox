import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/file-upload";
import type { Id } from "camox/_generated/dataModel";
import { ImageLightbox } from "./ImageLightbox";

/* -------------------------------------------------------------------------------------------------
 * SingleImageFieldEditor
 * -----------------------------------------------------------------------------------------------*/

const SingleImageFieldEditor = ({
  imageFieldName,
  currentData,
  onFieldChange,
}: {
  imageFieldName: string;
  currentData: Record<string, unknown>;
  onFieldChange: (fieldName: string, value: unknown) => void;
}) => {
  const img = currentData[imageFieldName] as
    | {
        url: string;
        alt: string;
        filename: string;
        mimeType: string;
        _fileId?: string;
      }
    | undefined;

  const hasImage = img?.url && !img.url.includes("placehold.co");
  const [lightboxOpen, setLightboxOpen] = React.useState(false);

  return (
    <div className="py-4 px-4 space-y-4">
      {hasImage && (
        <div className="flex flex-row items-center gap-2 px-1 py-1 max-w-full rounded-lg text-foreground hover:bg-accent/75 border-2">
          <button
            type="button"
            className="flex flex-1 items-center gap-2 min-w-0 cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
          >
            <div className="w-10 h-10 rounded border border-border overflow-hidden shrink-0">
              <img
                src={img.url}
                alt={img.alt || img.filename}
                className="w-full h-full object-cover"
              />
            </div>

            <p
              className="flex-1 truncate text-sm text-left"
              title={img.filename}
            >
              {img.filename || "Untitled"}
            </p>
          </button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => {
              onFieldChange(imageFieldName, {
                url: "",
                alt: "",
                filename: "",
                mimeType: "",
              });
            }}
          >
            <X className="h-4 w-4" />
          </Button>

          {img._fileId && (
            <ImageLightbox
              open={lightboxOpen}
              onOpenChange={setLightboxOpen}
              fileId={img._fileId as Id<"files">}
            />
          )}
        </div>
      )}

      <FileUpload
        initialValue={img}
        hidePreview
        onUploadComplete={(ref) => {
          onFieldChange(imageFieldName, ref);
        }}
        onClear={() => {
          onFieldChange(imageFieldName, {
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

export { SingleImageFieldEditor };
