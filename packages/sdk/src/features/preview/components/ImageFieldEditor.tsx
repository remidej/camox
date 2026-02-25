import * as React from "react";
import { useMutation } from "convex/react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/file-upload";
import { ImageIcon, Trash2 } from "lucide-react";
import { api } from "camox/_generated/api";
import type { Id } from "camox/_generated/dataModel";

/* -------------------------------------------------------------------------------------------------
 * AltTextEditor — debounced input for editing alt text on a file record
 * -----------------------------------------------------------------------------------------------*/

const AltTextEditor = ({
  fileId,
  initialAlt,
  updateFileAlt,
}: {
  fileId: Id<"files">;
  initialAlt: string;
  updateFileAlt: (args: { fileId: Id<"files">; alt: string }) => Promise<unknown>;
}) => {
  const [value, setValue] = React.useState(initialAlt);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setValue(initialAlt);
  }, [initialAlt]);

  const handleChange = (newValue: string) => {
    setValue(newValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      updateFileAlt({ fileId, alt: newValue });
    }, 500);
  };

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="space-y-2">
      <Label htmlFor="alt-text">Alt text</Label>
      <Input
        id="alt-text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Describe this image..."
      />
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * ImageFieldEditor
 * -----------------------------------------------------------------------------------------------*/

const ImageFieldEditor = ({
  imageFieldName,
  isMultiImage,
  currentData,
  blockId,
  onFieldChange,
}: {
  imageFieldName: string;
  isMultiImage: boolean;
  currentData: Record<string, unknown>;
  blockId: Id<"blocks">;
  onFieldChange: (fieldName: string, value: unknown) => void;
}) => {
  const createRepeatableItem = useMutation(
    api.repeatableItems.createRepeatableItem,
  );
  const deleteRepeatableItem = useMutation(
    api.repeatableItems.deleteRepeatableItem,
  );
  const updateFileAlt = useMutation(api.files.updateFileAlt);

  if (isMultiImage) {
    const items = (currentData[imageFieldName] ?? []) as Array<{
      _id: Id<"repeatableItems">;
      content: {
        image: {
          url: string;
          alt: string;
          filename: string;
          mimeType: string;
        };
      };
    }>;
    const validImages = items.filter(
      (item) =>
        item.content?.image?.url &&
        !item.content.image.url.includes("placehold.co"),
    );

    return (
      <div className="py-4 px-4 space-y-4">
        {validImages.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {validImages.map((item) => (
              <div
                key={item._id}
                className="relative group rounded-md overflow-hidden border border-border"
              >
                <img
                  src={item.content.image.url}
                  alt={
                    item.content.image.alt || item.content.image.filename
                  }
                  className="w-full h-24 object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 min-w-0">
                      <ImageIcon className="h-3 w-3 shrink-0 text-white/80" />
                      <span className="text-xs text-white/80 truncate">
                        {item.content.image.filename}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="bg-transparent! h-5 w-5 text-white/80 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() =>
                        deleteRepeatableItem({ itemId: item._id })
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <FileUpload
          multiple
          onUploadComplete={(ref) => {
            createRepeatableItem({
              blockId,
              fieldName: imageFieldName,
              content: { image: ref },
            });
          }}
        />
      </div>
    );
  }

  const img = currentData[imageFieldName] as
    | {
        url: string;
        alt: string;
        filename: string;
        mimeType: string;
        _fileId?: string;
      }
    | undefined;

  return (
    <div className="py-4 px-4 space-y-4">
      <FileUpload
        initialValue={img}
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
      {img?._fileId && (
        <AltTextEditor
          fileId={img._fileId as Id<"files">}
          initialAlt={img.alt ?? ""}
          updateFileAlt={updateFileAlt}
        />
      )}
    </div>
  );
};

export { ImageFieldEditor };
