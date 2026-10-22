import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Skeleton } from "@camox/ui/skeleton";
import * as React from "react";

import { AssetCard } from "@/features/content/components/AssetCard";
import { useProjectUuid } from "@/lib/auth";
import type { File } from "@/lib/queries";

import { reads, useReadQuery } from "../../../lib/studio-reads";
import { AssetLightbox } from "./AssetLightbox";

interface AssetPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetType: "Image" | "File";
  mode: "single" | "multiple";
  onSelectSingle: (file: File) => void;
  onSelectMultiple: (files: File[]) => void;
}

const AssetPickerModal = ({
  open,
  onOpenChange,
  assetType,
  mode,
  onSelectSingle,
  onSelectMultiple,
}: AssetPickerModalProps) => {
  const projectUuid = useProjectUuid();
  const { data: project } = useReadQuery(reads.project({ projectUuid }));
  const { data: allFiles } = useReadQuery(reads.fileList({ projectId: project?.id ?? 0 }), {
    enabled: !!project,
  });
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [lightboxFile, setLightboxFile] = React.useState<File | null>(null);

  // Closing the modal clears its selection.
  const [previousOpen, setPreviousOpen] = React.useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (!open) {
      setSelectedIds(new Set());
      setLightboxFile(null);
    }
  }

  const isImage = assetType === "Image";
  const files = React.useMemo(() => {
    if (!allFiles) return undefined;
    if (!isImage) return allFiles;
    return allFiles.filter((f) => f.mimeType?.startsWith("image/"));
  }, [allFiles, isImage]);

  const toggleSelection = (fileId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const handleConfirmMultiple = () => {
    if (!files) return;
    const selected = files.filter((f) => selectedIds.has(f.id));
    onSelectMultiple(selected);
    onOpenChange(false);
  };

  const handleSelectSingle = (file: File) => {
    onSelectSingle(file);
    onOpenChange(false);
  };

  const typeLabel = isImage ? "image" : "file";
  const typeLabelPlural = isImage ? "images" : "files";
  const title =
    mode === "multiple" ? `Add existing ${typeLabelPlural}` : `Add an existing ${typeLabel}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="-mx-2 overflow-y-auto px-2">
          {files === undefined && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-lg p-2">
                  <Skeleton className="aspect-4/3 w-full rounded-md" />
                  <Skeleton className="h-3.5 w-3/4 rounded" />
                </div>
              ))}
            </div>
          )}
          {files?.length === 0 && (
            <p className="text-muted-foreground py-8 text-center text-sm">No assets yet</p>
          )}
          {files && files.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {files.map((file) => (
                <AssetCard
                  key={file.id}
                  file={file}
                  selected={selectedIds.has(file.id)}
                  onSelect={() => {
                    if (mode === "single") {
                      handleSelectSingle(file);
                      return;
                    }

                    toggleSelection(file.id);
                  }}
                  onOpen={() => setLightboxFile(file)}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          {mode === "multiple" && (
            <Button
              variant="default"
              disabled={selectedIds.size === 0}
              onClick={handleConfirmMultiple}
            >
              Add selected ({selectedIds.size})
            </Button>
          )}
        </DialogFooter>

        {lightboxFile && (
          <AssetLightbox
            open={!!lightboxFile}
            onOpenChange={(open) => {
              if (!open) setLightboxFile(null);
            }}
            fileId={lightboxFile.id}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export { AssetPickerModal };
