import { z } from "zod";

/** The id of a content entity: one UUIDv7, kept in Live and every draft (ADR 0004). */
export const uuidv7Schema = z.uuidv7();

/**
 * Mints a UUIDv7 (RFC 9562): a 48-bit millisecond timestamp, then random bits.
 * The server mints ids; clients mint one only for optimistic inserts.
 */
export function generateUuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index--) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
