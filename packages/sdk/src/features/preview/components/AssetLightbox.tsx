import { Download, FileIcon, Link, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "camox/_generated/api";
import type { Id } from "camox/_generated/dataModel";
import { DebouncedFieldEditor } from "./DebouncedFieldEditor";

interface AssetLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: Id<"files">;
}

const AssetLightbox = ({ open, onOpenChange, fileId }: AssetLightboxProps) => {
  const file = useQuery(api.files.getFile, { fileId });
  const [zoomed, setZoomed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateFileFilename = useMutation(api.files.updateFileFilename);
  const updateFileAlt = useMutation(api.files.updateFileAlt);
  const deleteFile = useMutation(api.files.deleteFile);
  const setAiMetadata = useMutation(api.files.setAiMetadata);

  const handleCopyUrl = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(file.url);
    toast("Link copied to clipboard");
  };

  const handleDownload = () => {
    if (!file) return;
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.filename || "file";
    a.click();
  };

  const handleDelete = async () => {
    await deleteFile({ fileId });
    onOpenChange(false);
  };

  if (!file) return null;

  const isImage = file.mimeType?.startsWith("image/");

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
          {file.alt || file.filename || "File preview"}
        </DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 z-10"
          onClick={() => onOpenChange(false)}
        >
          <X />
        </Button>
        <div className="flex flex-row max-h-[90vh]">
          {isImage ? (
            <div
              ref={containerRef}
              className={cn(
                "checkered flex-1 min-w-0",
                zoomed
                  ? "overflow-auto"
                  : "overflow-hidden flex items-center justify-center p-6",
              )}
              onClick={(e) => {
                if (!zoomed) {
                  const img = e.currentTarget.querySelector("img");
                  if (!img) return;
                  const rect = img.getBoundingClientRect();
                  const fracX = (e.clientX - rect.left) / rect.width;
                  const fracY = (e.clientY - rect.top) / rect.height;

                  setZoomed(true);
                  requestAnimationFrame(() => {
                    const container = containerRef.current;
                    if (!container) return;
                    container.scrollLeft =
                      fracX * container.scrollWidth - container.clientWidth / 2;
                    container.scrollTop =
                      fracY * container.scrollHeight -
                      container.clientHeight / 2;
                  });
                } else {
                  setZoomed(false);
                }
              }}
            >
              <img
                src={file.url}
                alt={file.alt || file.filename}
                className={cn(
                  "shadow-lg",
                  zoomed
                    ? "w-[200%] max-w-none cursor-zoom-out"
                    : "max-w-full max-h-[calc(90vh-48px)] object-contain cursor-zoom-in",
                )}
              />
            </div>
          ) : (
            <div className="flex-1 min-w-0 min-h-[70vh] flex items-center justify-center p-6 bg-muted/30">
              <FileIcon className="h-16 w-16 text-muted-foreground" />
            </div>
          )}
          <div className="w-80 shrink-0 border-l border-border bg-background p-4 space-y-4 overflow-y-auto">
            <ButtonGroup>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
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
                    variant="outline"
                    size="icon"
                    onClick={handleDownload}
                  >
                    <Download />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleDelete}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </ButtonGroup>
            <div className="flex items-center gap-2">
              <Switch
                id="ai-metadata"
                checked={file.aiMetadataEnabled !== false}
                onCheckedChange={(checked) =>
                  setAiMetadata({ fileId, enabled: checked })
                }
              />
              <Label htmlFor="ai-metadata">AI metadata</Label>
            </div>
            <DebouncedFieldEditor
              fileId={fileId}
              label="File name"
              placeholder="File name..."
              initialValue={file.filename}
              disabled={file.aiMetadataEnabled !== false}
              onSave={({ fileId, value }) =>
                updateFileFilename({ fileId, filename: value })
              }
            />
            <DebouncedFieldEditor
              fileId={fileId}
              label="Alt text"
              placeholder="Describe this file..."
              initialValue={file.alt}
              disabled={file.aiMetadataEnabled !== false}
              rows={2}
              onSave={({ fileId, value }) =>
                updateFileAlt({ fileId, alt: value })
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { AssetLightbox };
