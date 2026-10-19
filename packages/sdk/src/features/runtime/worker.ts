/**
 * The Cloudflare Worker that serves a Camox app: point `main` in `wrangler.jsonc` at
 * `camox/worker`. Static files never reach it: Workers Static Assets serves them first in
 * production, and Vite does in dev.
 */
import { devHtml, handleCamoxRequest, runtimeBasePath } from "virtual:camox/server";

import { fetchLocalhostOnLoopback } from "./loopbackFetch";
import { shouldHandleRequest, withDevHtml } from "./workerRequest";

// Only the dev server has dev HTML.
if (devHtml) globalThis.fetch = fetchLocalhostOnLoopback(globalThis.fetch.bind(globalThis));

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (!shouldHandleRequest(request, runtimeBasePath)) return notFound();
    const response = await handleCamoxRequest(request);
    if (!response) return notFound();
    return withDevHtml(response, devHtml);
  },
};
