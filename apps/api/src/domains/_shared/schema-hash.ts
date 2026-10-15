import { stableStringify } from "../../lib/stable-stringify";

// A definition's schema hash covers what shapes content (ADR 0006): block content and settings
// schemas, the synced and layout-only flags, a layout's kind, and a collection's content schema.
// Titles, descriptions and defaults don't count. A development draft publishes only while its
// definitions have the same names and hashes as Live's.

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function blockSchemaHash(definition: {
  contentSchema: unknown;
  settingsSchema?: unknown;
  synced?: boolean | null;
  layoutOnly?: boolean | null;
}) {
  return sha256({
    contentSchema: definition.contentSchema ?? null,
    settingsSchema: definition.settingsSchema ?? null,
    synced: !!definition.synced,
    layoutOnly: !!definition.layoutOnly,
  });
}

export function layoutSchemaHash(layout: { kind: string }) {
  return sha256({ kind: layout.kind });
}

export function collectionSchemaHash(collection: { contentSchema: unknown }) {
  return sha256({ contentSchema: collection.contentSchema ?? null });
}
