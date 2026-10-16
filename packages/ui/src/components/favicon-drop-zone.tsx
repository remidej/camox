import { Upload } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

const FAVICON_MIME_TYPES = new Set([
  "image/png",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const FAVICON_ACCEPT = [...FAVICON_MIME_TYPES, ".ico"].join(",");
const FAVICON_MAX_BYTES = 500 * 1024;

/** Why `file` can't be a favicon, or `null` when it can. Mirrors the API's own checks. */
function validateFaviconFile(file: File) {
  if (!FAVICON_MIME_TYPES.has(file.type) && !file.name.toLowerCase().endsWith(".ico")) {
    return "Use a PNG, SVG, or ICO file.";
  }
  if (file.size > FAVICON_MAX_BYTES) return "Favicon must be 500 KB or smaller.";
  return null;
}

/**
 * A large area to drop or browse for a favicon, which previews `previewUrl` in its center.
 * It only picks the file: saving it is up to the caller.
 */
function FaviconDropZone({
  previewUrl,
  prompt,
  disabled,
  onFileSelected,
  className,
}: {
  previewUrl: string;
  prompt: string;
  disabled?: boolean;
  onFileSelected: (file: File) => void;
  className?: string;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragCounter = React.useRef(0);

  const select = (file: File | undefined) => {
    if (file && !disabled) onFileSelected(file);
  };

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        event.preventDefault();
        dragCounter.current++;
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounter.current--;
        if (dragCounter.current === 0) setIsDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        dragCounter.current = 0;
        setIsDragging(false);
        select(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={FAVICON_ACCEPT}
        className="hidden"
        onChange={(event) => {
          select(event.target.files?.[0]);
          event.target.value = ""; // allow re-selecting the same filename
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        className="hover:bg-accent/50 focus-visible:ring-ring/50 flex w-full flex-col items-center gap-5 rounded-xl border-2 border-dashed px-6 py-10 transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="bg-background flex size-20 items-center justify-center rounded-2xl border shadow-xs">
          <img src={previewUrl} alt="" className="size-12 object-contain" />
        </span>
        <span className="space-y-1 text-center">
          <span className="mx-auto block max-w-72 truncate text-sm font-medium">{prompt}</span>
          <span className="text-muted-foreground block text-xs">
            PNG, SVG, or ICO up to 500 KB. Square images work best.
          </span>
        </span>
      </button>
      {isDragging && (
        <div className="bg-background border-primary pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-3 border-dashed">
          <Upload className="text-primary size-8" />
          <p className="text-sm font-medium">Drop to use as favicon</p>
        </div>
      )}
    </div>
  );
}

export { FaviconDropZone, validateFaviconFile };
