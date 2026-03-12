import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface UploadDropZoneProps {
  onDrop: (files: FileList) => void;
  children: React.ReactNode;
  className?: string;
  label?: string;
}

export function UploadDropZone({
  onDrop,
  children,
  className,
  label = "Drop files to upload",
}: UploadDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      if (e.dataTransfer.files.length > 0) {
        onDrop(e.dataTransfer.files);
      }
    },
    [onDrop],
  );

  return (
    <div
      className={cn("relative min-h-full", className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className="bg-background absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 p-4">
          <div className="border-accent-foreground flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border-3 border-dashed">
            <Upload className="text-accent-foreground h-8 w-8" />
            <p className="text-accent-foreground text-sm font-medium">{label}</p>
          </div>
        </div>
      )}
    </div>
  );
}
