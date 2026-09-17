import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { Dialog, DialogContent, DialogTitle } from "@camox/ui/dialog";
import { Label } from "@camox/ui/label";
import { Switch } from "@camox/ui/switch";
import { toast } from "@camox/ui/toaster";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Download, FileIcon, Info, Link, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isRasterImage, transformImageUrl } from "@/core/lib/imageTransform";
import { UploadDropZone } from "@/features/content/components/UploadDropZone";
import { getApiUrl, getEnvironmentName } from "@/lib/api-client";
import { getAuthCookieHeader, getAuthRequestCredentials } from "@/lib/auth";
import { fileMutations, fileQueries } from "@/lib/queries";

import { DebouncedFieldEditor } from "./DebouncedFieldEditor";
import { formatRelativeTime, Metadata, MetadataRow } from "./Metadata";

function DeliveredSize({ bytes, raw }: { bytes: number | null; raw: number | null }) {
  if (bytes == null) return <>…</>;
  const savingsPct = raw != null && raw > 0 ? Math.round(((raw - bytes) / raw) * 100) : null;
  if (savingsPct == null || savingsPct <= 0) return <>≈{formatFileSize(bytes)}</>;
  return (
    <>
      ≈{formatFileSize(bytes)} <span className="text-muted-foreground">(−{savingsPct}%)</span>
    </>
  );
}

function DeliveredLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label="About image optimization"
            />
          }
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Visitors automatically receive a compressed WebP/AVIF version sized to their device.
          Estimates use {DELIVERED_PHONE_WIDTH}px (phone) and {DELIVERED_LAPTOP_WIDTH}px (laptop) —
          the original is preserved.
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const DELIVERED_PHONE_WIDTH = 640;
const DELIVERED_LAPTOP_WIDTH = 1280;

async function measureContentLength(url: string, signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(url, { signal });
    void res.body?.cancel();
    const cl = res.headers.get("content-length");
    if (!cl) return null;
    const parsed = Number.parseInt(cl, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface AssetLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: number;
}

const AssetLightbox = ({ open, onOpenChange, fileId }: AssetLightboxProps) => {
  const replaceFile = useMutation(fileMutations.replace());
  const deleteFile = useMutation(fileMutations.delete());
  const setAiMetadata = useMutation(fileMutations.setAiMetadata());
  const setFilename = useMutation(fileMutations.setFilename());
  const setAlt = useMutation(fileMutations.setAlt());
  const { data: file } = useQuery(fileQueries.get(fileId));
  const { data: usageCount } = useQuery(fileQueries.getUsageCount(fileId));
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
  const [deliveredSizes, setDeliveredSizes] = useState<{
    phone: number | null;
    laptop: number | null;
    measured: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setZoomed(false);
      setZoomedWidth(null);
    }
  }, [open]);

  const isImage = file?.mimeType?.startsWith("image/") ?? false;
  const canUseAiMetadata = isRasterImage(file?.mimeType);
  const fileUrl = file?.url;
  const fileMimeType = file?.mimeType;

  useEffect(() => {
    if (!open || !isImage || !fileUrl) {
      setDeliveredSizes(null);
      return;
    }
    const phoneUrl = transformImageUrl(fileUrl, {
      width: DELIVERED_PHONE_WIDTH,
      mimeType: fileMimeType,
      size: file?.size,
    });
    const laptopUrl = transformImageUrl(fileUrl, {
      width: DELIVERED_LAPTOP_WIDTH,
      mimeType: fileMimeType,
      size: file?.size,
    });
    // No transform applied (placeholder, localhost, SVG, etc.) — nothing meaningful to show.
    if (phoneUrl === fileUrl && laptopUrl === fileUrl) {
      setDeliveredSizes(null);
      return;
    }
    setDeliveredSizes({ phone: null, laptop: null, measured: false });
    const controller = new AbortController();
    void Promise.all([
      measureContentLength(phoneUrl, controller.signal),
      measureContentLength(laptopUrl, controller.signal),
    ]).then(([phone, laptop]) => {
      if (controller.signal.aborted) return;
      setDeliveredSizes({ phone, laptop, measured: true });
    });
    return () => controller.abort();
  }, [open, isImage, fileUrl, fileMimeType]);

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
        // Upload via API — we need the project ID from the current file
        const formData = new FormData();
        formData.append("file", droppedFile);
        formData.append("projectId", String(file?.projectId ?? 0));

        const envName = getEnvironmentName();
        const authCookieHeader = getAuthCookieHeader();
        const uploadRes = await fetch(`${getApiUrl()}/files/upload`, {
          method: "POST",
          body: formData,
          credentials: getAuthRequestCredentials(authCookieHeader),
          headers: {
            ...(authCookieHeader ? { "Better-Auth-Cookie": authCookieHeader } : {}),
            ...(envName ? { "x-environment-name": envName } : {}),
          },
        });

        if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

        setUploadState((prev) => (prev ? { ...prev, status: "committing", progress: 100 } : prev));

        const { id: newFileId } = (await uploadRes.json()) as { id: number };

        await replaceFile.mutateAsync({ id: fileId, newFileId });

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
    [replaceFile, file?.projectId, fileId, onOpenChange],
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
    await deleteFile.mutateAsync({ id: fileId });
    onOpenChange(false);
  };

  if (!file) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[90vh] max-h-[90vh] w-[90vw] max-w-[90vw] gap-0 overflow-hidden p-0 sm:max-w-[90vw]"
        showCloseButton={false}
        forceOverlay
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
                  <TooltipTrigger
                    render={
                      <Button type="button" variant="outline" size="icon" onClick={handleCopyUrl} />
                    }
                  >
                    <Link />
                  </TooltipTrigger>
                  <TooltipContent>Copy URL</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleDownload}
                      />
                    }
                  >
                    <Download />
                  </TooltipTrigger>
                  <TooltipContent>Download</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button type="button" variant="outline" size="icon" onClick={handleDelete} />
                    }
                  >
                    <Trash2 />
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </ButtonGroup>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      className={`flex items-center gap-2 ${canUseAiMetadata ? "" : "cursor-not-allowed"}`}
                    />
                  }
                >
                  <Switch
                    id="ai-metadata"
                    disabled={!canUseAiMetadata}
                    checked={canUseAiMetadata && file.aiMetadataEnabled !== false}
                    onCheckedChange={(checked) => {
                      setAiMetadata.mutate({ id: fileId, enabled: checked });
                    }}
                  />
                  <Label
                    htmlFor="ai-metadata"
                    className={canUseAiMetadata ? "" : "text-muted-foreground"}
                  >
                    AI metadata
                  </Label>
                </TooltipTrigger>
                {!canUseAiMetadata && (
                  <TooltipContent>AI metadata is only available for raster images.</TooltipContent>
                )}
              </Tooltip>
              <DebouncedFieldEditor
                label="File name"
                placeholder="File name..."
                initialValue={file.filename}
                disabled={canUseAiMetadata && file.aiMetadataEnabled !== false}
                onSave={(value) => setFilename.mutate({ id: fileId, filename: value })}
              />
              <DebouncedFieldEditor
                label="Alt text"
                placeholder="Describe this file..."
                initialValue={file.alt}
                disabled={canUseAiMetadata && file.aiMetadataEnabled !== false}
                rows={2}
                onSave={(value) => setAlt.mutate({ id: fileId, alt: value })}
              />
              <Metadata>
                <MetadataRow label="Format">
                  {file.mimeType.split("/").pop()?.toUpperCase() ?? "Unknown"}
                </MetadataRow>
                <MetadataRow label="Raw size">
                  {file.size != null ? formatFileSize(file.size) : "Unknown"}
                </MetadataRow>
                {isImage && deliveredSizes && (
                  <>
                    <MetadataRow label={<DeliveredLabel>On phone</DeliveredLabel>}>
                      <DeliveredSize bytes={deliveredSizes.phone} raw={file.size} />
                    </MetadataRow>
                    <MetadataRow label={<DeliveredLabel>On laptop</DeliveredLabel>}>
                      <DeliveredSize bytes={deliveredSizes.laptop} raw={file.size} />
                    </MetadataRow>
                  </>
                )}
                <MetadataRow label="Created">{formatRelativeTime(file.createdAt)}</MetadataRow>
                <MetadataRow label="Updated">{formatRelativeTime(file.updatedAt)}</MetadataRow>
                <MetadataRow label="Used in">
                  {usageCount == null && "…"}
                  {usageCount === 0 && "No blocks"}
                  {usageCount != null &&
                    usageCount > 0 &&
                    `${usageCount} ${usageCount === 1 ? "block" : "blocks"}`}
                </MetadataRow>
              </Metadata>
              <input
                ref={replaceInputRef}
                type="file"
                className="hidden"
                accept={isImage ? "image/*" : "*/*"}
                onChange={(e) => {
                  if (e.target.files) void handleReplaceDrop(e.target.files);
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
