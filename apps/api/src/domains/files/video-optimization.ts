// Media Transformations can output at most 60 seconds. Inspect the MP4 movie
// header before calling it so a longer upload can never be silently truncated.
const MIN_SIZE = 1024 * 1024;
const MAX_SIZE = 20 * 1024 * 1024; // Bound synchronous encoding and Worker memory use.
const MAX_MOVIE_HEADER = 1024 * 1024;
const MAX_DURATION_SECONDS = 60;
const MAX_DIMENSION = 2000; // Media Transformations' documented width/height limit.

function boxHeader(
  bytes: DataView,
  offset: number,
): { size: number; type: string; header: number } | null {
  if (offset + 8 > bytes.byteLength) return null;
  let size = bytes.getUint32(offset);
  const type = String.fromCharCode(
    ...new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 4, 4),
  );
  let header = 8;
  if (size === 1) {
    if (offset + 16 > bytes.byteLength) return null;
    const largeSize = Number(bytes.getBigUint64(offset + 8));
    if (!Number.isSafeInteger(largeSize)) return null;
    size = largeSize;
    header = 16;
  }
  if (size < header) return null;
  return { size, type, header };
}

export async function mp4Metadata(
  file: Blob,
): Promise<{ duration: number; width: number; height: number } | null> {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const headerBytes = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    const box = boxHeader(headerBytes, 0);
    if (!box || offset + box.size > file.size) return null;
    if (box.type === "moov") {
      if (box.size > MAX_MOVIE_HEADER) return null;
      const movie = new DataView(await file.slice(offset, offset + box.size).arrayBuffer());
      let childOffset = box.header;
      let duration: number | null = null;
      let dimensions: { width: number; height: number } | null = null;
      while (childOffset + 8 <= movie.byteLength) {
        const child = boxHeader(movie, childOffset);
        if (!child || childOffset + child.size > movie.byteLength) return null;
        if (child.type === "mvhd") {
          const data = childOffset + child.header;
          if (data + 1 > childOffset + child.size) return null;
          const version = movie.getUint8(data);
          const timeOffset = data + (version === 1 ? 20 : 12);
          if (
            (version !== 0 && version !== 1) ||
            timeOffset + (version === 1 ? 12 : 8) > childOffset + child.size
          )
            return null;
          const timescale = movie.getUint32(timeOffset);
          const ticks =
            version === 1
              ? Number(movie.getBigUint64(timeOffset + 4))
              : movie.getUint32(timeOffset + 4);
          if (timescale > 0 && Number.isSafeInteger(ticks)) duration = ticks / timescale;
        }
        if (child.type === "trak") {
          let trackOffset = childOffset + child.header;
          while (trackOffset + 8 <= childOffset + child.size) {
            const trackBox = boxHeader(movie, trackOffset);
            if (!trackBox || trackOffset + trackBox.size > childOffset + child.size) return null;
            if (trackBox.type === "tkhd" && trackBox.size >= trackBox.header + 8) {
              const end = trackOffset + trackBox.size;
              const width = movie.getUint32(end - 8) / 65536;
              const height = movie.getUint32(end - 4) / 65536;
              // Audio tracks report zero dimensions; do not mistake them for video.
              if (width >= 10 && height >= 10) dimensions = { width, height };
            }
            trackOffset += trackBox.size;
          }
        }
        childOffset += child.size;
      }
      if (duration == null || !dimensions) return null;
      return { duration, ...dimensions };
    }
    offset += box.size;
  }
  return null;
}

export function optimizedVideoKey(key: string): string {
  return `${key}.optimized.mp4`;
}

export async function optimizeVideo(
  file: File,
  key: string,
  bucket: R2Bucket,
  media?: MediaBinding,
): Promise<{ key: string; size: number } | null> {
  if (!media || file.type !== "video/mp4" || file.size < MIN_SIZE || file.size > MAX_SIZE)
    return null;
  try {
    const metadata = await mp4Metadata(file);
    if (!metadata || metadata.duration <= 0 || metadata.duration > MAX_DURATION_SECONDS)
      return null;
    const response = await media
      .input(file.stream())
      .transform({
        width: Math.min(MAX_DIMENSION, Math.round(metadata.width)),
        height: Math.min(MAX_DIMENSION, Math.round(metadata.height)),
        fit: "scale-down",
      })
      .output({ mode: "video" })
      .response();
    if (!response.ok || !response.body) throw new Error(`Media transformation: ${response.status}`);

    // Read with a hard cap: even an inefficient encode must not exhaust Worker memory.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const maxOutputSize = Math.floor(file.size * 0.9);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size >= maxOutputSize) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    if (!size) return null;
    const bytes = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.byteLength;
    }
    // The binding's undocumented no-dimensions default produced 360p from a
    // 720p upload. Reject a lower-resolution result rather than shipping it.
    const output = await mp4Metadata(new Blob([bytes]));
    const scale = Math.min(1, MAX_DIMENSION / metadata.width, MAX_DIMENSION / metadata.height);
    if (
      !output ||
      output.width < metadata.width * scale * 0.95 ||
      output.height < metadata.height * scale * 0.95 ||
      Math.abs(output.duration - metadata.duration) > 1
    ) {
      return null;
    }
    const optimizedKey = optimizedVideoKey(key);
    await bucket.put(optimizedKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
    return { key: optimizedKey, size };
  } catch (error) {
    console.warn("Video optimization failed; serving original", error);
    return null;
  }
}
