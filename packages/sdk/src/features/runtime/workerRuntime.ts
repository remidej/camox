/**
 * What the Worker entry (`camox/worker`) needs from camox, behind a package subpath. The Worker
 * entry is compiled into each website's build, so importing these by relative path would put a
 * second copy of camox's modules, and of their state, beside the package's.
 */
export { fetchLocalhostOnLoopback } from "./loopbackFetch";
export { PUBLIC_CACHE_NAME, readLiveCacheKey, respondThroughPublicCache } from "./publicCache";
export { rememberPublishingDraft } from "./publishingDraft";
export { shouldHandleRequest, withDevHtml } from "./workerRequest";
