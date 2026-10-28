/**
 * The Cloudflare Worker that serves a Camox app: point `main` in `wrangler.jsonc` at
 * `camox/worker`. Static files never reach it: Workers Static Assets serves them first in
 * production, and Vite does in dev.
 */
import {
  fetchLocalhostOnLoopback,
  PUBLIC_CACHE_NAME,
  readLiveCacheKey,
  rememberPublishingDraft,
  respondThroughPublicCache,
  shouldHandleRequest,
  withDevHtml,
} from "camox/_internal/workerRuntime";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  devHtml,
  handleCamoxRequest,
  isPublicRequest,
  publicCacheSource,
  readDefinitionSet,
  runtimeBasePath,
} from "virtual:camox/server";

// Only the dev server has dev HTML.
if (devHtml) globalThis.fetch = fetchLocalhostOnLoopback(globalThis.fetch.bind(globalThis));

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** What the Worker gets with each request: only `waitUntil` matters here. */
interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Answers a request, from the edge cache when every visitor sees the same. Dev serves code that
 * changes on every save, and a Worker calling this one without its context can't keep anything
 * past the response.
 */
function respond(request: Request, context?: WorkerContext): Promise<Response | null> {
  const caches = globalThis.caches as CacheStorage | undefined;
  if (devHtml || !context || !caches || !isPublicRequest(request))
    return handleCamoxRequest(request);
  const { apiUrl, projectUuid, build } = publicCacheSource;
  return respondThroughPublicCache(
    request,
    {
      cache: () => caches.open(PUBLIC_CACHE_NAME),
      liveCacheKey: () => readLiveCacheKey(apiUrl, projectUuid),
      build,
      waitUntil: (promise) => context.waitUntil(promise),
    },
    () => handleCamoxRequest(request),
  );
}

/**
 * The website's Definition Set, for the Worker that loads a revision, which calls it by the name
 * `DEFINITION_SET_ENTRYPOINT` holds. A named `WorkerEntrypoint` takes RPC calls only: no HTTP
 * request reaches it.
 */
export class CamoxDefinitionSet extends WorkerEntrypoint {
  read(): Promise<unknown> {
    return readDefinitionSet();
  }
}

export default {
  async fetch(request: Request, env?: unknown, context?: WorkerContext): Promise<Response> {
    rememberPublishingDraft(env);
    if (!shouldHandleRequest(request, runtimeBasePath)) return notFound();
    const response = await respond(request, context);
    if (!response) return notFound();
    return withDevHtml(response, devHtml);
  },
};
