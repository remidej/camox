import { prefersMarkdown } from "../routes/pageRuntime";

// Public renders (a visitor's pages, their Markdown Representation and data, llms.txt, the
// sitemap, OG images and the logo) are kept in Cloudflare's cache of the data center a request
// reaches. They're kept under the project's Live cache key, which the API replaces everywhere the
// moment Live changes, and under the website's build, which a release replaces: renders kept
// before either are left behind (ADR 0022). Only the key is read on each request.

/** Where a website's public renders are kept, and what they're kept under. */
export interface PublicCache {
  /** Cloudflare's cache in the request's data center: `caches.default`. */
  cache: Cache;
  /** The project's Live cache key, which changes whenever Live does; null when unreadable. */
  liveCacheKey: () => Promise<string | null>;
  /** The website's build, so a release never serves pages naming the last release's assets. */
  build: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** How long the edge keeps a render. Live changing replaces its key long before. */
const EDGE_MAX_AGE = 24 * 60 * 60;
/** Browsers can't be purged, so they ask again each time; the edge answers them. */
const VISITOR_CACHE_CONTROL = "public, max-age=0, must-revalidate";
/** The search parameter the cache key adds to a request's URL. */
const CACHE_KEY_PARAM = "__camox_cache";

/** The project's Live cache key, as the API serves it from its edge cache. */
export async function readLiveCacheKey(apiUrl: string, projectUuid: string) {
  try {
    const response = await fetch(`${apiUrl}/live-cache-keys/${encodeURIComponent(projectUuid)}`);
    return response.ok ? (await response.text()) || null : null;
  } catch {
    return null;
  }
}

/**
 * Answers a public request from the cache, or renders it and keeps the render when it may be
 * shared. Without a Live cache key, it renders without the cache: nothing tells when Live changed.
 */
export async function respondThroughPublicCache(
  request: Request,
  publicCache: PublicCache,
  render: () => Promise<Response | null>,
): Promise<Response | null> {
  const liveCacheKey = await publicCache.liveCacheKey();
  if (!liveCacheKey) return render();
  const key = cacheKeyOf(request, `${liveCacheKey}.${publicCache.build}`);
  const cached = await publicCache.cache.match(withValidators(key, request));
  if (cached) return forVisitors(cached, request);

  const response = await render();
  if (!response || !mayBeShared(response)) return response;
  publicCache.waitUntil(publicCache.cache.put(key, forEdge(response.clone())));
  return forVisitors(response, request);
}

/**
 * What a request's render is kept under: its URL, the representation it asks for, and the
 * version of Live and of the website it renders.
 */
function cacheKeyOf(request: Request, version: string): Request {
  const url = new URL(request.url);
  const representation = prefersMarkdown(request.headers.get("Accept") ?? "") ? "md" : "any";
  url.searchParams.set(CACHE_KEY_PARAM, `${version}.${representation}`);
  return new Request(url.toString(), { method: "GET" });
}

/** The cache key, asking for the part of the render the request does. */
function withValidators(key: Request, request: Request): Request {
  const headers = new Headers();
  for (const name of ["Range", "If-None-Match", "If-Modified-Since"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(key, { headers });
}

/** Whether a response is the same for every visitor: what a private render never is. */
function mayBeShared(response: Response): boolean {
  if (response.status !== 200 || response.headers.has("Set-Cookie")) return false;
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  return !/\b(private|no-store)\b/i.test(cacheControl);
}

/** How long browsers may keep a render: what it asked for, if it's versioned, else not at all. */
function visitorCacheControl(response: Response): string {
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  return /\bmax-age=[1-9]/.test(cacheControl) ? cacheControl : VISITOR_CACHE_CONTROL;
}

/** The render as the edge keeps it: as visitors get it, for as long as the edge keeps renders. */
function forEdge(response: Response): Response {
  const kept = new Response(response.body, response);
  kept.headers.set("Cache-Control", `${visitorCacheControl(response)}, s-maxage=${EDGE_MAX_AGE}`);
  return kept;
}

/** The render as visitors get it, without the edge's lifetime, which no cache downstream gets. */
function forVisitors(response: Response, request: Request): Response {
  const cacheControl = visitorCacheControl(response).replace(/,\s*s-maxage=\d+/, "");
  const answered = new Response(request.method === "HEAD" ? null : response.body, response);
  answered.headers.set("Cache-Control", cacheControl);
  return answered;
}
