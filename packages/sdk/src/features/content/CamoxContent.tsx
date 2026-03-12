import { api } from "camox/_generated/api";
import type { Id } from "camox/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";

import { PanelContent } from "@/components/ui/panel";
import { AssetLightbox } from "@/features/preview/components/AssetLightbox";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useMarqueeSelection } from "@/hooks/use-marquee-selection";

import { AssetCard } from "./components/AssetCard";
import { ContentSidebar } from "./components/ContentSidebar";
import { UploadDropZone } from "./components/UploadDropZone";
import { UploadProgressDrawer } from "./components/UploadProgressDrawer";

export const CamoxContent = () => {
  const files = useQuery(api.files.listFiles);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lightboxFileId, setLightboxFileId] = useState<Id<"files"> | null>(null);
  const { uploads, uploadFiles, clearAll } = useFileUpload();
  const containerRef = useRef<HTMLElement | null>(null);
  const { selectionRect, didDragRef, handlers } = useMarqueeSelection(
    containerRef,
    useCallback((ids: Set<string>) => setSelectedIds(ids), []),
  );

  return (
    <div className="flex flex-1 flex-row">
      <ContentSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <UploadDropZone onDrop={uploadFiles} className="flex flex-1 flex-col">
          <PanelContent
            ref={containerRef}
            className="relative p-4 select-none"
            onClick={() => {
              if (didDragRef.current) {
                didDragRef.current = false;
                return;
              }
              setSelectedIds(new Set());
            }}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
          >
            {files?.length === 0 && (
              <div className="flex h-full flex-1 items-center justify-center">
                <p className="text-muted-foreground">No assets yet</p>
              </div>
            )}
            {files && files.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {files.map((file) => (
                  <AssetCard
                    key={file._id}
                    file={file}
                    selected={selectedIds.has(file._id)}
                    onSelect={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(file._id)) {
                          next.delete(file._id);
                        } else {
                          next.add(file._id);
                        }
                        return next;
                      });
                    }}
                    onOpen={() => setLightboxFileId(file._id)}
                  />
                ))}
              </div>
            )}
            {selectionRect && (
              <div
                className="pointer-events-none absolute z-50 border border-blue-500 bg-blue-500/10"
                style={{
                  left: selectionRect.left,
                  top: selectionRect.top,
                  width: selectionRect.width,
                  height: selectionRect.height,
                }}
              />
            )}
          </PanelContent>
        </UploadDropZone>
      </div>
      <UploadProgressDrawer uploads={uploads} onClose={clearAll} />
      {lightboxFileId && (
        <AssetLightbox
          open
          onOpenChange={(open) => {
            if (!open) setLightboxFileId(null);
          }}
          fileId={lightboxFileId}
        />
      )}
    </div>
  );
};
