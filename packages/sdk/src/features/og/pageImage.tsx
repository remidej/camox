import type * as React from "react";

import type { CuratedLayoutContext } from "../../core/layoutContext";
import type { ImageStyle } from "./imageResponse";

/** The size every page image renders at, which the page head states. */
export const PAGE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * A page's image, chosen in order: the editor's custom image, else `/og` for the page, which
 * renders its layout's `toImage` or Camox's default image. `/og` names the page by its path,
 * with its locale's prefix.
 */
export function pageImageUrl({
  origin,
  path,
  customImageUrl,
}: {
  /** The site's origin, or "" for a URL relative to it. */
  origin: string;
  path: string;
  customImageUrl?: string | null;
}): string {
  return customImageUrl || `${origin}/og?${new URLSearchParams({ path }).toString()}`;
}

/** Camox's default image, for a page whose layout has no `toImage`: its title and project. */
export function DefaultPageImage({ page, project }: CuratedLayoutContext): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: "#09090b",
        padding: "60px 80px",
      }}
    >
      {project.name && (
        <div
          style={{
            fontSize: 24,
            color: "#a1a1aa",
            marginBottom: 24,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {project.name}
        </div>
      )}
      <div style={{ fontSize: 64, fontWeight: 700, color: "#fafafa", lineHeight: 1.2 }}>
        {page.title}
      </div>
    </div>
  );
}

/**
 * Renders a page image as a PNG response, styled like the site: its elements' `className`s match
 * the site's compiled stylesheet, and its text uses the site's fonts. Server only.
 */
export async function renderPageImage(
  element: React.ReactElement,
  style: ImageStyle,
): Promise<Response> {
  // This guard also lets Vite remove the wasm import from client builds.
  if (import.meta.env?.SSR === false) {
    throw new Error("OG images can only be rendered on the server.");
  }
  const { createImageResponse } = await import("camox/_internal/imageResponse");
  return createImageResponse(element, PAGE_IMAGE_SIZE, style);
}
