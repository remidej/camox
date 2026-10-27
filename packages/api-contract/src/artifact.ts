/**
 * Artifact titles, shared by the SDK (frame titles, studio sidebar) and the API (Markdown
 * Representation, write warnings), so every surface names an artifact the same way.
 */

export const UNTITLED_ARTIFACT = "Untitled artifact";

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()] ?? match;
    const code =
      entity[1] === "x" || entity[1] === "X"
        ? Number.parseInt(entity.slice(2), 16)
        : Number(entity.slice(1));
    return Number.isNaN(code) ? match : String.fromCodePoint(code);
  });
}

/** The non-empty `<title>` of an artifact source, if it has one. */
export function artifactSourceTitle(source: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source);
  const title = match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
  return title || undefined;
}

/** The artifact's name: its source's `<title>`, or "Untitled artifact". */
export function artifactTitle(source: string): string {
  return artifactSourceTitle(source) ?? UNTITLED_ARTIFACT;
}

/**
 * The hash an artifact source is stored and served under: the SHA-256 of its UTF-8 bytes, in
 * URL-safe base64 without padding. Shared by the API, which stores sources under it, and the SDK,
 * which names the URLs public pages load artifacts from.
 */
export async function artifactSourceHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
