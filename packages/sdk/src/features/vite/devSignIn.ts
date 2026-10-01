import childProcess from "node:child_process";
import { open } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import { createPreviewSignInUrl, isLoopbackUrl } from "@camox/cli/auth";
import type { ViteDevServer } from "vite-plus";

// Vite can reload this module when its config changes.
const openedKey = Symbol.for("camox.devSignIn.opened");
const processState = globalThis as typeof globalThis & { [openedKey]?: Set<string> };
const opened = (processState[openedKey] ??= new Set<string>());

function openBrowser(url: string, onError: () => void): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32.exe"
        : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  try {
    // Never pass the token URL through a shell or expose subprocess output.
    const child = childProcess.spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", onError);
    child.once("exit", (code) => {
      if (code !== 0) onError();
    });
    child.unref();
  } catch {
    onError();
  }
}

/** Mint only after Vite has resolved its actual port, including port fallback. */
export function installDevSignInLink(
  server: ViteDevServer,
  options: {
    projectSlug: string;
    environmentName: string;
    apiUrl: string;
    authToken: string;
    /** Opt in to opening the generated link; printing remains the default. */
    open?: boolean;
    /** Empty atomic marker in a launcher-owned directory, shared across child restarts. */
    openOnceFile?: string;
  },
): void {
  const controller = new AbortController();
  server.httpServer?.once("close", () => controller.abort());
  const printUrls = server.printUrls.bind(server);
  let started = false;
  server.printUrls = () => {
    printUrls();
    if (started) return;
    const urls = server.resolvedUrls;
    const destination = [...(urls?.local ?? []), ...(urls?.network ?? [])].find((url) =>
      isLoopbackUrl(new URL(url)),
    );
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
        if (options.open) await openSignInLink(url);
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

  async function openSignInLink(url: string): Promise<void> {
    let warned = false;
    const warn = () => {
      if (warned || controller.signal.aborted) return;
      warned = true;
      server.config.logger.warn(
        "Camox could not open your browser. Use the sign-in link printed above.",
      );
    };
    try {
      if (options.openOnceFile) {
        // Claim before launching, even on failure: retries/restarts must not open more tabs.
        const marker = await open(options.openOnceFile, "wx", 0o600);
        await marker.close();
      } else {
        const key = JSON.stringify([server.config.root, options.projectSlug]);
        if (opened.has(key)) return;
        opened.add(key);
      }
      if (controller.signal.aborted) return;
      openBrowser(url, warn);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      // Filesystem and opener errors can include arguments containing credentials.
      warn();
    }
  }
}
