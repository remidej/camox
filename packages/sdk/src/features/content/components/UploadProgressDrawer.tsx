import { AlertCircle, Check, ChevronDown, ChevronUp, File, Loader2, X } from "lucide-react";
import { useState } from "react";

import type { UploadItem } from "@/hooks/use-file-upload";

interface UploadProgressDrawerProps {
  uploads: UploadItem[];
  onClose: () => void;
}

export function UploadProgressDrawer({ uploads, onClose }: UploadProgressDrawerProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (uploads.length === 0) return null;

  const completedCount = uploads.filter((u) => u.status === "complete").length;
  const allComplete = completedCount === uploads.length;

  const headerText = allComplete
    ? `${completedCount} upload${completedCount !== 1 ? "s" : ""} complete`
    : `Uploading ${uploads.length} file${uploads.length !== 1 ? "s" : ""}`;

  return (
    <div className="border-border bg-background fixed right-4 bottom-4 z-50 w-80 rounded-lg border shadow-lg">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">{headerText}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCollapsed((c) => !c)} className="hover:bg-muted rounded p-1">
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button onClick={onClose} className="hover:bg-muted rounded p-1">
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

export function UploadItemRow({ item }: { item: UploadItem }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <File className="text-muted-foreground h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.filename}</p>
        {(item.status === "uploading" || item.status === "committing") && (
          <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-all duration-200"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
        {item.status === "error" && <p className="text-destructive mt-0.5 text-xs">{item.error}</p>}
      </div>
      <div className="shrink-0">
        {item.status === "uploading" && (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        )}
        {item.status === "committing" && <Loader2 className="text-primary h-4 w-4 animate-spin" />}
        {item.status === "complete" && <Check className="h-4 w-4 text-green-500" />}
        {item.status === "error" && <AlertCircle className="text-destructive h-4 w-4" />}
      </div>
    </div>
  );
}
