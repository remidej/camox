import { artifactTitle } from "@camox/api-contract";
import type * as React from "react";

import type { CamoxDocument } from "../defineDocument";
import type { ArtifactData } from "./artifactData";
import { ARTIFACT_RUNTIME } from "./artifactRuntime";

/** The frame attributes of an artifact source. */
export type ArtifactFrameProps = {
  srcDoc: string;
  sandbox: string;
  allow: string;
  title: string;
  loading: "lazy";
};

/** What `block.Artifact` passes to its render prop, to spread onto an `<iframe>`. */
export type ArtifactRenderProps = ArtifactFrameProps & {
  /** Connects the frame to the `camox` runtime inside it. */
  ref: React.RefCallback<HTMLIFrameElement>;
};

export { artifactTitle };

/** What an artifact's document gets from the website besides its source. */
export type ArtifactDocumentOptions = {
  /** The website's font links as HTML, from `artifactFontLinks`. */
  fontLinks?: string;
  /** The initial Artifact Data, which the runtime exposes as `camox.data`. */
  data?: ArtifactData;
};

const FONT_LINK_RELS = new Set(["stylesheet", "preconnect"]);
// unhead options on a tag, not HTML attributes.
const UNHEAD_TAG_OPTIONS = new Set([
  "key",
  "tagPriority",
  "tagPosition",
  "tagDuplicateStrategy",
  "processTemplateParams",
  "innerHTML",
  "textContent",
]);

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function renderLink(link: Record<string, unknown>) {
  let attributes = "";
  for (const [name, value] of Object.entries(link)) {
    if (UNHEAD_TAG_OPTIONS.has(name) || !/^[a-z][a-z0-9-]*$/i.test(name)) continue;
    if (value === true) attributes += ` ${name}`;
    if (typeof value === "string" || typeof value === "number") {
      attributes += ` ${name}="${escapeAttribute(String(value))}"`;
    }
  }
  return `<link${attributes}>`;
}

/**
 * The initial Artifact Data as an inert JSON script, which the runtime reads on first access.
 * `<` is escaped so no value can close the script early.
 */
function artifactDataScript(data: ArtifactData) {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return `<script type="application/json" data-camox-data>${json}</script>`;
}

/**
 * The stylesheet and preconnect links of the project's document definition, as HTML, so artifacts
 * use the website's fonts from their first render. Nothing else from the document's head: its
 * title, meta, scripts and icons belong to the website, not to the artifact.
 */
export function artifactFontLinks(document: CamoxDocument | undefined) {
  const links: unknown = document?.link;
  if (!Array.isArray(links)) return "";
  return links
    .filter((link): link is Record<string, unknown> => {
      if (typeof link !== "object" || link === null) return false;
      const rel = (link as { rel?: unknown }).rel;
      if (typeof rel !== "string") return false;
      return rel.split(/\s+/).some((token) => FONT_LINK_RELS.has(token.toLowerCase()));
    })
    .map(renderLink)
    .join("");
}

/**
 * The document an artifact frame loads: the `camox` runtime, the website's font links, the initial
 * Artifact Data, then the stored source. The doctype comes first so the runtime's script never
 * puts the page in quirks mode; the source's own doctype, if any, is then ignored by the parser.
 */
function artifactDocument(source: string, { fontLinks = "", data = {} }: ArtifactDocumentOptions) {
  const head = `<script>${ARTIFACT_RUNTIME}</script>${fontLinks}${artifactDataScript(data)}`;
  return `<!doctype html>${head}${source}`;
}

/**
 * The frame props for an artifact source, with its initial Artifact Data and the website's font
 * links. This getter is the boundary that hides how the source reaches the frame (inline `srcdoc`
 * today), so blocks never depend on it.
 */
export function artifactFrameProps(
  source: string,
  options: ArtifactDocumentOptions = {},
): ArtifactFrameProps {
  return {
    srcDoc: artifactDocument(source, options),
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
export function artifactPlaceholderProps(): ArtifactFrameProps {
  return artifactFrameProps(PLACEHOLDER_SOURCE);
}

/** Whether a stored artifact value holds a source to render. */
export function isArtifactSource(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
