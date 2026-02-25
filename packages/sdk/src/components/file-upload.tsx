"use client";

import { Button } from "@/components/ui/button";
import { useMutation } from "convex/react";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api } from "camox/_generated/api";

const FS_PREFIX = "/fs";

function getSiteUrl() {
  const convexUrl = (import.meta.env.VITE_CONVEX_URL ?? "") as string;
  if (convexUrl.includes(".cloud")) {
    return convexUrl.replace(/\.cloud$/, ".site");
  }
  throw new Error(
    "Could not derive Convex site URL. Set VITE_CONVEX_SITE_URL for non-cloud deployments.",
  );
}

export interface FileRef {
  _fileId: string;
}

interface ImageValue {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  _fileId?: string;
}

interface FileUploadProps {
  initialValue?: ImageValue;
  multiple?: boolean;
  onUploadComplete: (ref: FileRef) => void;
  onClear?: () => void;
}

export function FileUpload({ initialValue, multiple, onUploadComplete, onClear }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const commitFile = useMutation(api.files.commitFile);
  const siteUrl = getSiteUrl();

  const uploadSingleFile = useCallback(
    async (file: File): Promise<FileRef> => {
      // 1. Upload blob to ConvexFS endpoint with progress tracking
      const blobId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 100));
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

        xhr.addEventListener("error", () => {
          reject(new Error("Upload failed"));
        });

        xhr.open("POST", `${siteUrl}${FS_PREFIX}/upload`);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      // 2. Commit the file — creates a record in the files table
      const { fileId } = await commitFile({
        blobId,
        filename: file.name,
        contentType: file.type,
        siteUrl,
      });

      return { _fileId: fileId };
    },
    [siteUrl, commitFile],
  );

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        if (multiple) {
          for (const file of Array.from(files)) {
            const ref = await uploadSingleFile(file);
            onUploadComplete(ref);
          }
        } else {
          const ref = await uploadSingleFile(files[0]);
          onUploadComplete(ref);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [multiple, uploadSingleFile, onUploadComplete],
  );

  const handleBoxClick = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  };

  const hasImage =
    initialValue?.url && !initialValue.url.includes("placehold.co");

  return (
    <div className="space-y-4">
      {hasImage && (
        <div className="space-y-2">
          <div className="relative rounded-md overflow-hidden border border-border">
            <img
              src={initialValue.url}
              alt={initialValue.alt || initialValue.filename}
              className="w-full h-auto object-cover max-h-48"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground truncate">
                {initialValue.filename}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="bg-transparent! hover:text-red-500"
              onClick={() => onClear?.()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div
        className="border-2 border-dashed border-border rounded-md p-8 flex flex-col items-center justify-center text-center cursor-pointer"
        onClick={handleBoxClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="mb-2 bg-muted rounded-full p-3">
          <Upload className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-pretty text-sm font-medium text-foreground">
          {multiple ? "Upload images" : hasImage ? "Replace image" : "Upload an image"}
        </p>
        <p className="text-pretty text-sm text-muted-foreground mt-1">
          or,{" "}
          <label
            htmlFor="fileUpload"
            className="text-primary hover:text-primary/90 font-medium cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            click to browse
          </label>{" "}
          (4MB max)
        </p>
        <input
          type="file"
          id="fileUpload"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          multiple={multiple}
          disabled={uploading}
          onChange={(e) => {
            handleFileSelect(e.target.files);
            e.target.value = "";
          }}
        />

        {uploading && (
          <div className="w-full mt-4 space-y-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{progress}%</p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
