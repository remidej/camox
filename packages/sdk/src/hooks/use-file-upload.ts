import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { getApiUrl } from "@/lib/api-client";
import { getAuthCookieHeader } from "@/lib/auth";
import { getUploadDraftHeaders } from "@/lib/studio-draft";

export interface UploadItem {
  id: string;
  filename: string;
  progress: number;
  status: "uploading" | "complete" | "error";
  error?: string;
}

interface UseFileUploadOptions {
  projectId?: number;
  onFileCommitted?: (result: {
    fileId: string;
    url: string;
    filename: string;
    mimeType: string;
  }) => void;
}

export function useFileUpload(options?: UseFileUploadOptions) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const apiUrl = getApiUrl();
  const nextId = useRef(0);
  const projectIdRef = useRef(options?.projectId);
  const onFileCommittedRef = useRef(options?.onFileCommitted);
  useLayoutEffect(() => {
    projectIdRef.current = options?.projectId;
    onFileCommittedRef.current = options?.onFileCommitted;
  });

  const uploadSingleFile = useCallback(
    async (file: File, itemId: string) => {
      // Upload via XHR for progress tracking
      const result = await new Promise<{
        id: string;
        url: string;
        filename: string;
        mimeType: string;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        // An upload on Live starts a draft, like any other content write.
        const draft = getUploadDraftHeaders();

        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploads((prev) => prev.map((u) => (u.id === itemId ? { ...u, progress } : u)));
        });

        xhr.addEventListener("load", () => {
          draft.settle(xhr.status >= 200 && xhr.status < 300);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error("Invalid response from upload"));
            }
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => {
          draft.settle(false);
          reject(new Error("Upload failed"));
        });

        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", String(projectIdRef.current ?? 0));

        const uploadUrl = `${apiUrl}/files/upload`;
        const authCookieHeader = getAuthCookieHeader();
        xhr.open("POST", uploadUrl);
        xhr.withCredentials = !authCookieHeader;
        if (authCookieHeader) xhr.setRequestHeader("Better-Auth-Cookie", authCookieHeader);
        for (const [name, value] of Object.entries(draft.headers)) {
          xhr.setRequestHeader(name, value);
        }
        xhr.send(formData);
      });

      onFileCommittedRef.current?.({
        fileId: result.id,
        url: result.url,
        filename: result.filename,
        mimeType: result.mimeType,
      });

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
    [apiUrl],
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
      void Promise.all(
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
