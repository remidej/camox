import { Database } from "lucide-react";
import * as React from "react";

import { transformImageUrl } from "@/core/lib/imageTransform";

import { PageStatusBadge } from "./PageStatusBadge";

export type RecordStatus = "draft" | "published" | "modified";

export type RecordThumbnail = { url: string; alt?: string; mimeType?: string; size?: number };

/** Thumbnail from the record's first Image field, or null for the icon fallback. */
export function recordThumbnail(
  contentSchema: unknown,
  content: Record<string, unknown> | undefined,
): RecordThumbnail | null {
  const properties = (contentSchema as { properties?: Record<string, { fieldType?: string }> })
    ?.properties;
  if (!properties || !content) return null;
  const imageField = Object.keys(properties).find(
    (name) => properties[name]?.fieldType === "Image",
  );
  if (!imageField) return null;
  const value = content[imageField] as Partial<RecordThumbnail> | null | undefined;
  if (!value || typeof value.url !== "string" || !value.url) return null;
  return { url: value.url, alt: value.alt, mimeType: value.mimeType, size: value.size };
}

/**
 * A linked collection record: thumbnail, label, publication badge and collection title.
 * `actions` holds trailing controls (unlink now, reorder handles for reference lists later).
 */
export function RecordCard({
  label,
  collectionTitle,
  status,
  thumbnail,
  onOpen,
  actions,
}: {
  label: string;
  collectionTitle: string;
  status?: RecordStatus;
  thumbnail?: RecordThumbnail | null;
  onOpen?: () => void;
  actions?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {thumbnail ? (
          <img
            src={transformImageUrl(thumbnail.url, {
              width: 128,
              mimeType: thumbnail.mimeType,
              size: thumbnail.size,
            })}
            alt={thumbnail.alt ?? ""}
            className="size-full object-cover"
          />
        ) : (
          <Database aria-hidden className="size-4" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{label}</span>
          {status && <PageStatusBadge status={status} size="sm" />}
        </span>
        <span className="text-muted-foreground truncate text-xs">{collectionTitle}</span>
      </span>
    </>
  );

  return (
    <div
      data-record-card
      className="text-foreground hover:bg-accent/75 flex max-w-full items-center gap-1 rounded-lg border-2 p-1"
    >
      {onOpen ? (
        <button
          type="button"
          aria-label={`Open ${label}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm p-1 text-left"
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 p-1">{body}</div>
      )}
      {actions}
    </div>
  );
}
