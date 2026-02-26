import * as React from "react";
import { useMutation } from "convex/react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileUpload } from "@/components/file-upload";
import { api } from "camox/_generated/api";
import type { Id } from "camox/_generated/dataModel";

/* -------------------------------------------------------------------------------------------------
 * DebouncedFieldEditor — debounced input for editing a file field
 * -----------------------------------------------------------------------------------------------*/

const DebouncedFieldEditor = ({
  fileId,
  label,
  placeholder,
  initialValue,
  onSave,
}: {
  fileId: Id<"files">;
  label: string;
  placeholder: string;
  initialValue: string;
  onSave: (args: { fileId: Id<"files">; value: string }) => void;
}) => {
  const [value, setValue] = React.useState(initialValue);
  const timerRef = React.useRef<number | null>(null);
  const inputId = React.useId();

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleChange = (newValue: string) => {
    setValue(newValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onSave({ fileId, value: newValue });
    }, 500);
  };

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
};

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
          <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
            <DialogContent
              className="w-fit max-w-[90vw] max-h-[90vh] p-0 overflow-hidden border-none bg-transparent shadow-none sm:max-w-[90vw] gap-0"
              showCloseButton={false}
            >
              <DialogTitle className="sr-only">
                {img.alt || img.filename || "Image preview"}
              </DialogTitle>
              <img
                src={img.url}
                alt={img.alt || img.filename}
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-md"
              />
            </DialogContent>
          </Dialog>
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
