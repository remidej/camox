"use client";

import { api } from "camox/_generated/api";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";

import { FS_PREFIX, getSiteUrl } from "@/lib/convex-site";

export interface UploadItem {
  id: string;
  filename: string;
  progress: number;
  status: "uploading" | "committing" | "complete" | "error";
  error?: string;
}

interface UseFileUploadOptions {
  onFileCommitted?: (result: {
    fileId: string;
    url: string;
    filename: string;
    mimeType: string;
  }) => void;
}

export function useFileUpload(options?: UseFileUploadOptions) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const commitFile = useMutation(api.files.commitFile);
  const siteUrl = getSiteUrl();
  const nextId = useRef(0);
  const onFileCommittedRef = useRef(options?.onFileCommitted);
  onFileCommittedRef.current = options?.onFileCommitted;

  const uploadSingleFile = useCallback(
    async (file: File, itemId: string) => {
      // Upload blob with XHR for progress tracking
      const blobId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploads((prev) => prev.map((u) => (u.id === itemId ? { ...u, progress } : u)));
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

      // Commit file record
      setUploads((prev) =>
        prev.map((u) => (u.id === itemId ? { ...u, status: "committing" as const } : u)),
      );

      const result = await commitFile({
        blobId,
        filename: file.name,
        contentType: file.type,
        siteUrl,
      });

      onFileCommittedRef.current?.(result);

      setUploads((prev) =>
        prev.map((u) =>
          u.id === itemId ? { ...u, status: "complete" as const, progress: 100 } : u,
        ),
      );

      // Auto-remove after 2s
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.id !== itemId));
      }, 2000);
    },
    [siteUrl, commitFile],
  );

  const uploadFiles = useCallback(
    (files: FileList) => {
      const newItems: UploadItem[] = Array.from(files).map((file) => ({
        id: String(nextId.current++),
        filename: file.name,
        progress: 0,
        status: "uploading" as const,
      }));

      setUploads((prev) => [...prev, ...newItems]);

      // Upload all in parallel
      Promise.all(
        Array.from(files).map((file, i) =>
          uploadSingleFile(file, newItems[i].id).catch((err) => {
            const message = err instanceof Error ? err.message : "Upload failed";
            setUploads((prev) =>
              prev.map((u) =>
                u.id === newItems[i].id ? { ...u, status: "error" as const, error: message } : u,
              ),
            );
          }),
        ),
      );
    },
    [uploadSingleFile],
  );

  const clearAll = useCallback(() => {
    setUploads([]);
  }, []);

  return { uploads, uploadFiles, clearAll };
}
