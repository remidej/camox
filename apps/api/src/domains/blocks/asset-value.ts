import { uuidv7Schema } from "@camox/api-contract/ids";

import { assetShape } from "../_shared/fields";

/** Persist only managed file references; hydrated URLs and placeholders are render-only. */
export function sanitizeAssetValue(value: unknown): { _fileId: string } | null {
  const fileId = uuidv7Schema.safeParse(assetFileId(value));
  if (!fileId.success) return null;
  return { _fileId: fileId.data };
}

/**
 * What validation sees of an asset: hydrated shapes without a file reference read as
 * null, but a file reference is kept as given, so one that isn't a UUIDv7 is rejected.
 */
export function projectAssetValue(value: unknown): { _fileId: unknown } | null {
  const fileId = assetFileId(value);
  if (fileId == null) return null;
  return { _fileId: fileId };
}

function assetFileId(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return (value as Record<string, unknown>)._fileId;
}

/** A field value as writes store it: assets keep their file reference only. */
export function normalizeFieldValue(value: unknown, fieldType: string | undefined): unknown {
  const shape = assetShape(fieldType);
  if (shape === "single") return sanitizeAssetValue(value);
  if (shape === "list" && Array.isArray(value)) return value.map(sanitizeAssetValue);
  return value;
}
