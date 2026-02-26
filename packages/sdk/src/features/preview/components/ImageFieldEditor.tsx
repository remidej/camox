import * as React from "react";
import { useMutation } from "convex/react";

import { FileUpload } from "@/components/file-upload";
import { api } from "camox/_generated/api";
import type { Id } from "camox/_generated/dataModel";
import { DebouncedFieldEditor } from "./DebouncedFieldEditor";
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
  const updateFileAlt = useMutation(api.files.updateFileAlt);
  const updateFileFilename = useMutation(api.files.updateFileFilename);

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
        <>
          <button
            type="button"
            className="relative rounded-md overflow-hidden border border-border w-full cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
          >
            <img
              src={img.url}
              alt={img.alt || img.filename}
              className="w-full h-auto object-cover max-h-48"
            />
          </button>
          <ImageLightbox
            open={lightboxOpen}
            onOpenChange={setLightboxOpen}
            imageUrl={img.url}
            imageAlt={img.alt || img.filename}
            fileId={img._fileId as Id<"files"> | undefined}
            filename={img.filename ?? ""}
            alt={img.alt ?? ""}
            onSaveFilename={({ fileId, value }) =>
              updateFileFilename({ fileId, filename: value })
            }
            onSaveAlt={({ fileId, value }) =>
              updateFileAlt({ fileId, alt: value })
            }
          />
        </>
      )}
      {img?._fileId && (
        <>
          <DebouncedFieldEditor
            fileId={img._fileId as Id<"files">}
            label="File name"
            placeholder="File name..."
            initialValue={img.filename ?? ""}
            onSave={({ fileId, value }) =>
              updateFileFilename({ fileId, filename: value })
            }
          />
          <DebouncedFieldEditor
            fileId={img._fileId as Id<"files">}
            label="Alt text"
            placeholder="Describe this image..."
            initialValue={img.alt ?? ""}
            onSave={({ fileId, value }) =>
              updateFileAlt({ fileId, alt: value })
            }
          />
        </>
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
