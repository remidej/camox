import { Button } from "@camox/ui/button";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { PanelContent } from "@camox/ui/panel";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { AssetLightbox } from "@/features/preview/components/AssetLightbox";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useMarqueeSelection } from "@/hooks/use-marquee-selection";
import { useProjectSlug } from "@/lib/auth";
import { fileMutations, fileQueries, projectQueries } from "@/lib/queries";
import { checkIfInputFocused } from "@/lib/utils";

import { AssetCard } from "./components/AssetCard";
import { AssetCardSkeleton } from "./components/AssetCardSkeleton";
import { UploadDropZone } from "./components/UploadDropZone";
import { UploadProgressDrawer } from "./components/UploadProgressDrawer";

export const ContentAssets = () => {
  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: files } = useQuery({
    ...fileQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lightboxFileId, setLightboxFileId] = useState<number | null>(null);
  const { uploads, uploadFiles, clearAll } = useFileUpload({ projectId: project?.id });
  const deleteFiles = useMutation({
    ...fileMutations.deleteMany(),
    onSuccess: () => setSelectedIds(new Set()),
  });
  const containerRef = useRef<HTMLElement | null>(null);
  const { selectionRect, didDragRef, handlers } = useMarqueeSelection(
    containerRef,
    useCallback((ids: Set<string>) => setSelectedIds(ids), []),
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let the lightbox handle its own Escape close.
      if (lightboxFileId !== null) return;
      if (checkIfInputFocused()) return;
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lightboxFileId]);

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <UploadDropZone onDrop={uploadFiles} className="flex min-h-0 flex-1 flex-col">
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
            {files === undefined && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {Array.from({ length: 12 }, (_, i) => (
                  <AssetCardSkeleton key={i} />
                ))}
              </div>
            )}
            {files?.length === 0 && (
              <div className="flex h-full flex-1 items-center justify-center">
                <p className="text-muted-foreground">No assets yet</p>
              </div>
            )}
            {files && files.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {files.map((file) => (
                  <AssetCard
                    key={file.id}
                    file={file}
                    selected={selectedIds.has(String(file.id))}
                    onSelect={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(String(file.id))) {
                          next.delete(String(file.id));
                        } else {
                          next.add(String(file.id));
                        }
                        return next;
                      });
                    }}
                    onOpen={() => setLightboxFileId(file.id)}
                  />
                ))}
              </div>
            )}
            {selectionRect && (
              <div
                className="border-primary bg-primary/10 pointer-events-none absolute z-50 border"
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
      {selectedIds.size > 0 && (
        <FloatingToolbar className="bottom-4 min-w-xs justify-between gap-4 pl-3">
          <span className="text-muted-foreground">
            <span className="font-semibold">{selectedIds.size}</span> asset
            {selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <Button
            variant="destructive"
            disabled={deleteFiles.isPending}
            onClick={() => deleteFiles.mutate({ ids: [...selectedIds].map(Number) })}
          >
            {deleteFiles.isPending ? "Deleting…" : "Delete"}
          </Button>
        </FloatingToolbar>
      )}
      {lightboxFileId && (
        <AssetLightbox
          open
          onOpenChange={(open) => {
            if (!open) setLightboxFileId(null);
          }}
          fileId={lightboxFileId}
        />
      )}
    </>
  );
};
