import { setTimeout } from "node:timers/promises";

import { createPreviewSignInUrl, isLoopbackUrl } from "@camox/cli/auth";
import type { ViteDevServer } from "vite-plus";

/** Mint only after Vite has resolved its actual port, including port fallback. */
export function installDevSignInLink(
  server: ViteDevServer,
  options: {
    projectSlug: string;
    environmentName: string;
    apiUrl: string;
    authToken: string;
  },
): void {
  const controller = new AbortController();
  server.httpServer?.once("close", () => controller.abort());
  const printUrls = server.printUrls.bind(server);
  let started = false;
  server.printUrls = () => {
    printUrls();
    if (started) return;
    const destination = server.resolvedUrls?.local.find((url) => isLoopbackUrl(new URL(url)));
    if (!destination) return;
    started = true;
    void printSignInLink(destination);
  };

  async function printSignInLink(destination: string): Promise<void> {
    // The monorepo starts the API alongside Vite; allow it time to become ready.
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    while (!signal.aborted) {
      try {
        const url = await createPreviewSignInUrl(
          destination,
          {
            projectSlug: options.projectSlug,
            environmentName: options.environmentName,
            apiUrl: options.apiUrl,
          },
          options.authToken,
          signal,
        );
        if (signal.aborted) return;
        server.config.logger.info(
          `  ➜  Camox sign in (single-use, expires in 3 minutes; do not share): ${url}`,
        );
        return;
      } catch {
        // Never log backend bodies or request errors: they can contain credentials.
        try {
          await setTimeout(1_000, undefined, { signal });
        } catch {
          break;
        }
      }
    }
    if (controller.signal.aborted) return;
    server.config.logger.warn(
      "Camox sign-in link unavailable. Use the normal local URL to sign in, or run camox preview for a fresh link.",
    );
  }
}
