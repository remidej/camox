import { Data, Effect } from "effect";

/** The image handed to the metadata model could not be fetched or is unusable. */
export class MetadataImageError extends Data.TaggedError("MetadataImageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Only accept formats supported by the metadata model. The transform normally
// returns WebP, but local URLs and already-transformed URLs can bypass it.
function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (mimeType === "image/jpeg") return startsWith([0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/webp") {
    return startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
  }
  return false;
}

export const readMetadataImage = Effect.fn("files.readMetadataImage")(function* (
  response: Response,
) {
  if (!response.ok) {
    return yield* new MetadataImageError({
      message: `Metadata image fetch failed: HTTP ${response.status}`,
    });
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
    return yield* new MetadataImageError({
      message: `Unsupported metadata image content type: ${mimeType || "missing"}`,
    });
  }

  const buffer = yield* Effect.tryPromise({
    try: () => response.arrayBuffer(),
    catch: (cause) =>
      new MetadataImageError({ message: "Metadata image could not be read", cause }),
  });
  const bytes = new Uint8Array(buffer);
  // Reject error pages even when a proxy incorrectly labels them as images.
  // This is a signature check, not a full image decoder.
  if (!hasImageSignature(bytes, mimeType)) {
    return yield* new MetadataImageError({ message: "Invalid metadata image signature" });
  }

  return { bytes, mimeType };
});
