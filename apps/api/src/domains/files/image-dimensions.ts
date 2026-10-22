/**
 * An image's dimensions in pixels, read from the header of a PNG, JPEG, GIF or WebP, as
 * Structured Data describes images by them. Null for other files and unreadable headers.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  const found = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  try {
    if (bytes[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
      return found(view.getUint32(16), view.getUint32(20));
    }
    if (ascii(0, 4) === "GIF8") return found(view.getUint16(6, true), view.getUint16(8, true));
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return webpDimensions(bytes, view, ascii);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes, view);
  } catch {
    // A header cut short reads past the bytes given.
  }
  return null;
}

const uint24 = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);

function webpDimensions(
  bytes: Uint8Array,
  view: DataView,
  ascii: (offset: number, length: number) => string,
) {
  const chunk = ascii(12, 4);
  if (chunk === "VP8X") return { width: uint24(bytes, 24) + 1, height: uint24(bytes, 27) + 1 };
  if (chunk === "VP8 ") {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** A JPEG's dimensions, from its first start-of-frame segment. */
function jpegDimensions(bytes: Uint8Array, view: DataView) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Padding before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start-of-frame markers, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}
