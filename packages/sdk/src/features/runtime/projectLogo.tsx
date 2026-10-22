import {
  buildDefaultFaviconUrl,
  buildFaviconUrl,
  createServerApiClient,
  isNotFoundError,
} from "../routes/pageRuntime";
import { RUNTIME_ROUTE_PATHS } from "./runtimeRoutes";

/**
 * The project's logo in its Structured Data: its favicon, rendered as a PNG by the runtime.
 * Search engines want a raster logo at least 112px wide, and favicons are often SVGs or tiny.
 */

/** The size the logo is served at: square, and wider than search engines' minimum. */
export const LOGO_SIZE = 512;

/**
 * Where the runtime serves its project's logo. `url` makes a runtime path absolute. The project's
 * version only busts caches: the route always serves the project's current logo.
 */
export function projectLogo(
  url: (path: string) => string,
  project: { updatedAt: number | string },
) {
  const search = new URLSearchParams({ v: String(project.updatedAt) });
  return {
    url: `${url(RUNTIME_ROUTE_PATHS.logo)}?${search}`,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  };
}

/** An image fetched as a data URL, which the renderer reads without fetching it again. */
async function asDataUrl(url: string): Promise<string | null> {
  const response = await fetch(new Request(url));
  if (!response.ok) return null;
  const type = response.headers.get("Content-Type") ?? "application/octet-stream";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${type};base64,${btoa(binary)}`;
}

async function renderLogo(source: string): Promise<ArrayBuffer> {
  const { ImageResponse } = await import("camox/_internal/imageResponse");
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <img src={source} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>,
    { width: LOGO_SIZE, height: LOGO_SIZE, format: "png" },
  ).arrayBuffer();
}

/** The project's favicon as a PNG. A favicon the renderer can't read gives way to the default. */
async function renderProjectLogo(
  apiUrl: string,
  project: { id: number; updatedAt: number | string },
): Promise<ArrayBuffer | null> {
  for (const url of [buildFaviconUrl(apiUrl, project), buildDefaultFaviconUrl(apiUrl)]) {
    const source = await asDataUrl(url);
    if (!source) continue;
    try {
      return await renderLogo(source);
    } catch {
      // Try the next source.
    }
  }
  return null;
}

/**
 * The last logo rendered, with the version of the project it was rendered for, by project. A
 * runtime serves one project, so it keeps one logo, and renders again only once the project
 * changed.
 */
const renderedLogos = new Map<string, { version: string; png: Promise<ArrayBuffer | null> }>();

/**
 * The website's own project's logo, as a PNG. The request names no project, and its `v` only
 * busts caches: whatever it says, the logo is the project's current one, rendered once per
 * version of the project.
 */
export async function createProjectLogoResponse(
  request: Request,
  { apiUrl, projectUuid }: { apiUrl?: string; projectUuid?: string },
): Promise<Response> {
  if (!apiUrl || !projectUuid) return new Response("Not found", { status: 404 });
  let project: { id: number; updatedAt: number | string };
  try {
    project = await createServerApiClient(apiUrl).projects.getSummary({ projectUuid });
  } catch (error) {
    if (isNotFoundError(error)) return new Response("Not found", { status: 404 });
    throw error;
  }
  const version = String(project.updatedAt);
  const key = `${apiUrl} ${projectUuid}`;
  let rendered = renderedLogos.get(key);
  if (rendered?.version !== version) {
    rendered = { version, png: renderProjectLogo(apiUrl, project) };
    renderedLogos.set(key, rendered);
  }
  const png = await rendered.png;
  if (!png) {
    // A favicon that failed to load may load next time.
    if (renderedLogos.get(key) === rendered) renderedLogos.delete(key);
    return new Response("Not found", { status: 404 });
  }
  // Caches keep only the current version's URL: an older or made-up one would outlive a change.
  const current = new URL(request.url).searchParams.get("v") === version;
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": current ? "public, max-age=86400" : "public, no-cache",
    },
  });
}
