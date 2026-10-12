/** What `block.Artifact` passes to its render prop, to spread onto an `<iframe>`. */
export type ArtifactRenderProps = {
  srcDoc: string;
  sandbox: string;
  allow: string;
  title: string;
  loading: "lazy";
};

const UNTITLED = "Untitled artifact";
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

/** The artifact's accessible name: its source's `<title>`, or "Untitled artifact". */
export function artifactTitle(source: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source);
  const title = match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
  return title || UNTITLED;
}

/**
 * The frame props for an artifact source. This getter is the boundary that hides how the source
 * reaches the frame (inline `srcdoc` today), so blocks never depend on it.
 */
export function artifactFrameProps(source: string): ArtifactRenderProps {
  return {
    srcDoc: source,
    // Never `allow-same-origin`: the opaque origin keeps the page away from the site and studio.
    sandbox: "allow-scripts",
    allow: "fullscreen; clipboard-write",
    title: artifactTitle(source),
    loading: "lazy",
  };
}

const PLACEHOLDER_SOURCE = `<!doctype html>
<html>
  <head>
    <title>Empty artifact</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: grid;
        place-items: center;
        min-height: 8rem;
        box-sizing: border-box;
        border: 1px dashed #a1a1aa;
        background: #f4f4f5;
        color: #71717a;
        font: 14px/1.4 system-ui, sans-serif;
        text-align: center;
      }
    </style>
  </head>
  <body><p>Empty artifact<br />Ask an agent to create it</p></body>
</html>`;

/** The frame props of an empty artifact in the studio preview, so it takes the block's frame. */
export function artifactPlaceholderProps(): ArtifactRenderProps {
  return artifactFrameProps(PLACEHOLDER_SOURCE);
}

/** Whether a stored artifact value holds a source to render. */
export function isArtifactSource(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
