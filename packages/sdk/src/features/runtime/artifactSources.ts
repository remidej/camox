import { artifactSourceOf } from "../../core/lib/artifact";

/**
 * A page's HTML holds each rendered artifact source in its frame's `srcdoc`, so the server leaves
 * them out of the hydration data, and the client takes them back from the frames before
 * hydrating. Each source left out becomes a reference to it, made of this prefix and a key.
 */
const REFERENCE = "\u0000camox-artifact-source:";

/**
 * The HTML parser turns every CR LF and lone CR into LF, attribute values included, so sources
 * are keyed with LF only.
 */
const normalizeNewlines = (value: string) => value.replace(/\r\n?/g, "\n");

/** A key that tells a source apart from the others on its page: its length and FNV-1a hash. */
function referenceTo(source: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${REFERENCE}${source.length}:${(hash >>> 0).toString(36)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A copy of a JSON value with every string replaced. */
function mapStrings(value: unknown, replace: (value: string) => string): unknown {
  if (typeof value === "string") return replace(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, replace));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapStrings(item, replace)]),
  );
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeAttribute(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
    const code =
      name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return String.fromCodePoint(code);
  });
}

/**
 * The page's dehydrated state without the artifact sources its HTML already holds in frames,
 * each replaced by a reference. Sources the HTML doesn't render stay, as the client couldn't
 * take them back.
 */
export function omitArtifactSources(dehydratedState: unknown, html: string): unknown {
  const rendered = new Set<string>();
  for (const [, srcdoc] of html.matchAll(/<iframe\b[^>]*?\ssrcdoc="([^"]*)"/gi)) {
    const source = artifactSourceOf(normalizeNewlines(decodeAttribute(srcdoc)));
    if (source) rendered.add(source);
  }
  if (rendered.size === 0) return dehydratedState;
  return mapStrings(dehydratedState, (value) => {
    const source = normalizeNewlines(value);
    return rendered.has(source) ? referenceTo(source) : value;
  });
}

/**
 * The dehydrated state with the artifact sources that `omitArtifactSources` left out taken back
 * from the frames under `root`, as the browser parsed them, so they hydrate the frames unchanged.
 */
export function restoreArtifactSources(
  dehydratedState: unknown,
  root: Pick<ParentNode, "querySelectorAll">,
): unknown {
  const sources = new Map<string, string>();
  for (const frame of root.querySelectorAll("iframe[srcdoc]")) {
    const source = artifactSourceOf(frame.getAttribute("srcdoc") ?? "");
    if (source) sources.set(referenceTo(normalizeNewlines(source)), source);
  }
  return mapStrings(dehydratedState, (value) => {
    if (!value.startsWith(REFERENCE)) return value;
    const source = sources.get(value);
    if (source !== undefined) return source;
    console.error("Camox: an artifact's frame was missing from the page before hydration.");
    return "";
  });
}
