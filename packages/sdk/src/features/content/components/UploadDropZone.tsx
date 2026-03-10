import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface UploadDropZoneProps {
  onDrop: (files: FileList) => void;
  children: React.ReactNode;
  className?: string;
}

export function UploadDropZone({
  onDrop,
  children,
  className,
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
      className={cn("relative", className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-background p-4">
          <div className="flex flex-col items-center justify-center gap-2 w-full h-full rounded-lg border-3 border-dashed border-accent-foreground">
            <Upload className="h-8 w-8 text-accent-foreground" />
            <p className="text-sm font-medium text-accent-foreground">
              Drop files to upload
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
