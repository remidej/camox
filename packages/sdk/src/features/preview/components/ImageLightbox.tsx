import { Download, Link } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Id } from "camox/_generated/dataModel";
import { DebouncedFieldEditor } from "./DebouncedFieldEditor";

interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  imageAlt: string;
  fileId?: Id<"files">;
  filename: string;
  alt: string;
  onSaveFilename: (args: { fileId: Id<"files">; value: string }) => void;
  onSaveAlt: (args: { fileId: Id<"files">; value: string }) => void;
}

const ImageLightbox = ({
  open,
  onOpenChange,
  imageUrl,
  imageAlt,
  fileId,
  filename,
  alt,
  onSaveFilename,
  onSaveAlt,
}: ImageLightboxProps) => {
  const [zoomed, setZoomed] = useState(false);

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(imageUrl);
    toast("Link copied to clipboard");
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = filename || "image";
    a.click();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setZoomed(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden sm:max-w-[90vw] gap-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          {imageAlt || filename || "Image preview"}
        </DialogTitle>
        <div className="flex flex-row max-h-[90vh]">
          <div
            className={cn(
              "checkered flex-1 min-w-0",
              zoomed ? "overflow-auto" : "overflow-hidden flex items-center justify-center p-6",
            )}
            onClick={() => setZoomed((z) => !z)}
          >
            <img
              src={imageUrl}
              alt={imageAlt}
              className={cn(
                "shadow-lg",
                zoomed
                  ? "w-[200%] max-w-none cursor-zoom-out"
                  : "max-w-full max-h-[calc(90vh-48px)] object-contain cursor-zoom-in",
              )}
            />
          </div>
          {fileId && (
            <div className="w-72 shrink-0 border-l border-border bg-background p-6 space-y-4 overflow-y-auto">
              <div className="flex justify-end gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleCopyUrl}
                    >
                      <Link />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy URL</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleDownload}
                    >
                      <Download />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download</TooltipContent>
                </Tooltip>
              </div>
              <DebouncedFieldEditor
                fileId={fileId}
                label="File name"
                placeholder="File name..."
                initialValue={filename}
                onSave={onSaveFilename}
              />
              <DebouncedFieldEditor
                fileId={fileId}
                label="Alt text"
                placeholder="Describe this image..."
                initialValue={alt}
                onSave={onSaveAlt}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { ImageLightbox };
