import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  File,
  Loader2,
  X,
} from "lucide-react";
import { useState } from "react";
import type { UploadItem } from "@/hooks/use-file-upload";

interface UploadProgressDrawerProps {
  uploads: UploadItem[];
  onClose: () => void;
}

export function UploadProgressDrawer({
  uploads,
  onClose,
}: UploadProgressDrawerProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (uploads.length === 0) return null;

  const completedCount = uploads.filter(
    (u) => u.status === "complete",
  ).length;
  const allComplete = completedCount === uploads.length;

  const headerText = allComplete
    ? `${completedCount} upload${completedCount !== 1 ? "s" : ""} complete`
    : `Uploading ${uploads.length} file${uploads.length !== 1 ? "s" : ""}`;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-background shadow-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">{headerText}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 hover:bg-muted"
          >
            {collapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-60 overflow-y-auto">
          {uploads.map((item) => (
            <UploadItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadItemRow({ item }: { item: UploadItem }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <File className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{item.filename}</p>
        {(item.status === "uploading" || item.status === "committing") && (
          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
        {item.status === "error" && (
          <p className="text-xs text-destructive mt-0.5">{item.error}</p>
        )}
      </div>
      <div className="shrink-0">
        {item.status === "uploading" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {item.status === "committing" && (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
        {item.status === "complete" && (
          <Check className="h-4 w-4 text-green-500" />
        )}
        {item.status === "error" && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </div>
    </div>
  );
}
