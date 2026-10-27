import { matchRuntimeOwnedRoute } from "./runtimeRoutes";

/** How the Camox Worker picks the requests it answers and prepares its responses. */
function isDocumentRequest(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? "";
  // Agents ask for the Markdown Representation of the same page URLs.
  return accept.includes("text/html") || accept.includes("text/markdown") || accept.includes("*/*");
}

/** The request's path inside the runtime, or `null` when it falls outside the base path. */
function getRuntimePathname(pathname: string, basePath: string): string | null {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (!pathname.startsWith(`${basePath}/`)) return null;
  return pathname.slice(basePath.length) || "/";
}

export function shouldHandleRequest(request: Request, basePath: string): boolean {
  const pathname = getRuntimePathname(new URL(request.url).pathname, basePath);
  if (!pathname) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (matchRuntimeOwnedRoute(pathname)) return true;
  if (pathname === "/camox" || pathname.startsWith("/camox/")) return true;
  // Besides its own routes, a page's Markdown Representation is the only file-like URL it answers.
  if (pathname.endsWith(".md")) return true;
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  if (pathname.startsWith("/@") || pathname.startsWith("/src/")) return false;
  if (pathname.startsWith("/__vite")) return false;
  if (pathname.startsWith("/node_modules/")) return false;
  return isDocumentRequest(request);
}

/** Adds what Vite injects into HTML in dev, such as its client and React Refresh. */
export async function withDevHtml(
  response: Response,
  html: { head: string; body: string } | null,
): Promise<Response> {
  if (!html) return response;
  if (!(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  const document = (await response.text())
    .replace(/<head(\s[^>]*)?>/i, (tag) => tag + html.head)
    .replace(/<\/body>/i, (tag) => html.body + tag);
  return new Response(document, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
