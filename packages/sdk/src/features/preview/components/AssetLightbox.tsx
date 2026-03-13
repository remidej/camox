import { api } from "camox/_generated/api";
import type { Id } from "camox/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, Download, FileIcon, Link, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UploadDropZone } from "@/features/content/components/UploadDropZone";
import { FS_PREFIX, getSiteUrl } from "@/lib/convex-site";

import { DebouncedFieldEditor } from "./DebouncedFieldEditor";

function MetadataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0">{label}</span>
      <span className="border-border min-w-0 flex-1 border-b" />
      <span className="text-foreground shrink-0">{children}</span>
    </div>
  );
}

function formatRelativeTime(epochMs: number): string {
  const now = Temporal.Now.instant();
  const then = Temporal.Instant.fromEpochMilliseconds(epochMs);
  const duration = now.since(then);
  const totalSeconds = duration.total("seconds");

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (totalSeconds < 60) return rtf.format(-Math.floor(totalSeconds), "second");
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return rtf.format(-totalMinutes, "minute");
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return rtf.format(-totalHours, "hour");
  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 30) return rtf.format(-totalDays, "day");
  const totalMonths = Math.floor(totalDays / 30);
  if (totalMonths < 12) return rtf.format(-totalMonths, "month");
  return rtf.format(-Math.floor(totalDays / 365), "year");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface AssetLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: Id<"files">;
}

const AssetLightbox = ({ open, onOpenChange, fileId }: AssetLightboxProps) => {
  const file = useQuery(api.files.getFile, { fileId });
  const usageCount = useQuery(api.files.getFileUsageCount, { fileId });
  const [uploadState, setUploadState] = useState<{
    status: "uploading" | "committing" | "complete" | "error";
    progress: number;
    filename: string;
    error?: string;
  } | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [zoomedWidth, setZoomedWidth] = useState<number | null>(null);
  const clickFractionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setZoomed(false);
      setZoomedWidth(null);
    }
  }, [open]);

  useEffect(() => {
    if (!zoomed || !zoomedWidth || !containerRef.current || !clickFractionRef.current) return;
    const container = containerRef.current;
    const img = container.querySelector("img");
    if (!img) return;

    requestAnimationFrame(() => {
      const frac = clickFractionRef.current!;
      const scrollX = img.offsetLeft + img.width * frac.x - container.clientWidth / 2;
      const scrollY = img.offsetTop + img.height * frac.y - container.clientHeight / 2;
      container.scrollTo(scrollX, scrollY);
      clickFractionRef.current = null;
    });
  }, [zoomed, zoomedWidth]);

  const updateFileFilename = useMutation(api.files.updateFileFilename);
  const updateFileAlt = useMutation(api.files.updateFileAlt);
  const deleteFile = useMutation(api.files.deleteFile);
  const replaceFile = useMutation(api.files.replaceFile);
  const setAiMetadata = useMutation(api.files.setAiMetadata);
  const commitFile = useMutation(api.files.commitFile);
  const siteUrl = getSiteUrl();

  const handleReplaceDrop = useCallback(
    async (files: FileList) => {
      const droppedFile = files[0];
      if (!droppedFile) return;

      setUploadState({
        status: "uploading",
        progress: 0,
        filename: droppedFile.name,
      });

      try {
        const blobId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              setUploadState((prev) =>
                prev
                  ? {
                      ...prev,
                      progress: Math.round((e.loaded / e.total) * 100),
                    }
                  : prev,
              );
            }
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                resolve(response.blobId);
              } catch {
                reject(new Error("Invalid response from upload"));
              }
            } else {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          });
          xhr.addEventListener("error", () => reject(new Error("Upload failed")));
          xhr.open("POST", `${siteUrl}${FS_PREFIX}/upload`);
          xhr.setRequestHeader("Content-Type", droppedFile.type);
          xhr.send(droppedFile);
        });

        setUploadState((prev) => (prev ? { ...prev, status: "committing", progress: 100 } : prev));

        const { fileId: newFileId } = await commitFile({
          blobId,
          filename: droppedFile.name,
          contentType: droppedFile.type,
          size: droppedFile.size,
          siteUrl,
        });

        await replaceFile({
          oldFileId: fileId,
          newFileId: newFileId as Id<"files">,
        });

        setUploadState((prev) => (prev ? { ...prev, status: "complete" } : prev));
        toast.success("File replaced");
        setTimeout(() => {
          setUploadState(null);
          onOpenChange(false);
        }, 600);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setUploadState((prev) => (prev ? { ...prev, status: "error", error: message } : prev));
        toast.error(message);
        setTimeout(() => setUploadState(null), 3000);
      }
    },
    [siteUrl, commitFile, replaceFile, fileId, onOpenChange],
  );

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[90vh] max-h-[90vh] w-[90vw] max-w-[90vw] gap-0 overflow-hidden p-0 sm:max-w-[90vw]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{file.alt || file.filename || "File preview"}</DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 z-10"
          onClick={() => onOpenChange(false)}
        >
          <X />
        </Button>
        <div className="flex h-full flex-row">
          <UploadDropZone
            label="Drop file to replace"
            onDrop={handleReplaceDrop}
            className="h-full min-w-0 flex-1"
          >
            {isImage ? (
              <div
                ref={containerRef}
                className={`checkered absolute inset-0 ${
                  zoomed ? "overflow-auto" : "flex items-center justify-center overflow-hidden p-6"
                }`}
                onClick={(e) => {
                  const img = containerRef.current?.querySelector("img");
                  if (!img) return;

                  if (!zoomed) {
                    const rect = img.getBoundingClientRect();
                    clickFractionRef.current = {
                      x: (e.clientX - rect.left) / rect.width,
                      y: (e.clientY - rect.top) / rect.height,
                    };
                    const container = containerRef.current!;
                    const scaleForWidth = (container.clientWidth * 2.5) / img.clientWidth;
                    const scaleForHeight = (container.clientHeight * 2.5) / img.clientHeight;
                    setZoomedWidth(img.clientWidth * Math.max(scaleForWidth, scaleForHeight));
                    setZoomed(true);
                  } else {
                    setZoomed(false);
                    setZoomedWidth(null);
                    containerRef.current?.scrollTo(0, 0);
                  }
                }}
              >
                {zoomed ? (
                  <div className="flex min-h-full items-center justify-center">
                    <img
                      src={file.url}
                      alt={file.alt || file.filename || ""}
                      className="cursor-zoom-out"
                      style={{ width: zoomedWidth ?? undefined }}
                      draggable={false}
                    />
                  </div>
                ) : (
                  <img
                    src={file.url}
                    alt={file.alt || file.filename || ""}
                    className="max-h-full max-w-full cursor-zoom-in object-contain shadow-lg"
                    draggable={false}
                  />
                )}
              </div>
            ) : (
              <div className="bg-muted/30 flex h-full min-h-[70vh] items-center justify-center p-6">
                <FileIcon className="text-muted-foreground h-16 w-16" />
              </div>
            )}
            {uploadState && (
              <div className="bg-background/80 absolute inset-0 z-30 flex items-center justify-center backdrop-blur-sm">
                <div className="border-border bg-background w-64 rounded-lg border p-4 shadow-lg">
                  <div className="flex items-center gap-2">
                    <div className="shrink-0">
                      {uploadState.status === "uploading" && (
                        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                      )}
                      {uploadState.status === "committing" && (
                        <Loader2 className="text-primary h-4 w-4 animate-spin" />
                      )}
                      {uploadState.status === "complete" && (
                        <Check className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {uploadState.status === "uploading" && "Uploading…"}
                        {uploadState.status === "committing" && "Processing…"}
                        {uploadState.status === "complete" && "Replaced"}
                        {uploadState.status === "error" && "Upload failed"}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {uploadState.filename}
                      </p>
                    </div>
                  </div>
                  {(uploadState.status === "uploading" || uploadState.status === "committing") && (
                    <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full transition-all duration-200"
                        style={{ width: `${uploadState.progress}%` }}
                      />
                    </div>
                  )}
                  {uploadState.status === "error" && uploadState.error && (
                    <p className="text-destructive mt-2 text-xs">{uploadState.error}</p>
                  )}
                </div>
              </div>
            )}
          </UploadDropZone>
          <div className="border-border bg-background flex w-80 shrink-0 flex-col border-l">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <ButtonGroup>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="outline" size="icon" onClick={handleCopyUrl}>
                      <Link />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy URL</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="outline" size="icon" onClick={handleDownload}>
                      <Download />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="outline" size="icon" onClick={handleDelete}>
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
                  onCheckedChange={(checked) => setAiMetadata({ fileId, enabled: checked })}
                />
                <Label htmlFor="ai-metadata">AI metadata</Label>
              </div>
              <DebouncedFieldEditor
                label="File name"
                placeholder="File name..."
                initialValue={file.filename}
                disabled={file.aiMetadataEnabled !== false}
                onSave={(value) => updateFileFilename({ fileId, filename: value })}
              />
              <DebouncedFieldEditor
                label="Alt text"
                placeholder="Describe this file..."
                initialValue={file.alt}
                disabled={file.aiMetadataEnabled !== false}
                rows={2}
                onSave={(value) => updateFileAlt({ fileId, alt: value })}
              />
              <div className="text-muted-foreground space-y-1 text-sm">
                <MetadataRow label="Format">
                  {file.mimeType.split("/").pop()?.toUpperCase() ?? "Unknown"}
                </MetadataRow>
                <MetadataRow label="Size">
                  {file.size != null ? formatFileSize(file.size) : "Unknown"}
                </MetadataRow>
                <MetadataRow label="Created">{formatRelativeTime(file.createdAt)}</MetadataRow>
                <MetadataRow label="Updated">{formatRelativeTime(file.updatedAt)}</MetadataRow>
                <MetadataRow label="Used in">
                  {usageCount == null && "…"}
                  {usageCount === 0 && "No blocks"}
                  {usageCount != null &&
                    usageCount > 0 &&
                    `${usageCount} ${usageCount === 1 ? "block" : "blocks"}`}
                </MetadataRow>
              </div>
              <input
                ref={replaceInputRef}
                type="file"
                className="hidden"
                accept={isImage ? "image/*" : "*/*"}
                onChange={(e) => {
                  if (e.target.files) handleReplaceDrop(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => replaceInputRef.current?.click()}
              >
                {isImage ? "Replace image" : "Replace file"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { AssetLightbox };
