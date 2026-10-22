import { buildDefaultFaviconUrl, buildFaviconUrl } from "../routes/pageRuntime";
import { RUNTIME_ROUTE_PATHS } from "./runtimeRoutes";

/**
 * The project's logo in its Structured Data: its favicon, rendered as a PNG by the runtime.
 * Search engines want a raster logo at least 112px wide, and favicons are often SVGs or tiny.
 */

/** The size the logo is served at: square, and wider than search engines' minimum. */
export const LOGO_SIZE = 512;

/** Where the runtime serves a project's logo. `url` makes a runtime path absolute. */
export function projectLogo(
  url: (path: string) => string,
  project: { id: number; updatedAt: number | string },
) {
  const search = new URLSearchParams({ project: String(project.id), v: String(project.updatedAt) });
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

/**
 * The logo the request's `project` names, as a PNG. A favicon the renderer can't read, such as
 * an ICO, gives way to the default favicon.
 */
export async function createProjectLogoResponse(
  request: Request,
  apiUrl: string | undefined,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("project"));
  if (!apiUrl || !Number.isInteger(id) || id <= 0)
    return new Response("Not found", { status: 404 });

  const favicon = buildFaviconUrl(apiUrl, { id, updatedAt: searchParams.get("v") ?? "" });
  let png: ArrayBuffer | undefined;
  for (const url of [favicon, buildDefaultFaviconUrl(apiUrl)]) {
    const source = await asDataUrl(url);
    if (!source) continue;
    try {
      png = await renderLogo(source);
      break;
    } catch {
      // Try the next source.
    }
  }
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
