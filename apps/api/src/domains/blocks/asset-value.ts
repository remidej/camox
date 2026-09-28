/** Persist only managed file references; hydrated URLs and placeholders are render-only. */
export function sanitizeAssetValue(value: unknown): { _fileId: number } | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)._fileId;
  if (raw == null) return null;
  const id = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(id)) return null;
  return { _fileId: id };
}

export function normalizeFieldValue(value: unknown, fieldType: string | undefined): unknown {
  if (fieldType === "Image" || fieldType === "File") return sanitizeAssetValue(value);
  if ((fieldType === "ImageList" || fieldType === "FileList") && Array.isArray(value)) {
    return value.map(sanitizeAssetValue);
  }
  return value;
}
