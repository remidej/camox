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

export async function readMetadataImage(response: Response) {
  if (!response.ok) throw new Error(`Metadata image fetch failed: HTTP ${response.status}`);

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
    throw new Error(`Unsupported metadata image content type: ${mimeType || "missing"}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  // Reject error pages even when a proxy incorrectly labels them as images.
  // This is a signature check, not a full image decoder.
  if (!hasImageSignature(bytes, mimeType)) throw new Error("Invalid metadata image signature");

  return { bytes, mimeType };
}
