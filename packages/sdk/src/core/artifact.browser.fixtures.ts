import { fileURLToPath } from "node:url";

import { artifactSourceHash } from "@camox/api-contract";
import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type Frame,
  type JSHandle,
  type Page,
} from "playwright-core";
import { build } from "vite/rolldown";

import { ARTIFACTS_PATH_PREFIX } from "../features/runtime/runtimeRoutes";
import {
  artifactFrameProps,
  artifactShellHash,
  artifactTitle,
  artifactUrlDocument,
  type ArtifactFrameProps,
} from "./lib/artifact";
import type { ArtifactData } from "./lib/artifactData";
import type { ArtifactHost, ArtifactHostOptions, ArtifactHostState } from "./lib/artifactHost";

// The real-browser test level for the artifact runtime: an Artifact Document in a sandboxed frame
// of a host page, in headless Chromium, connected to the artifact host as a website connects it.
// Run with `pnpm --filter camox test:browser`, one test file at a time, each launching one browser
// that it closes in a `finally`.

/** The website's origin in the browser; every request to it is answered by the harness. */
export const WEBSITE_ORIGIN = "https://website.test";

/** A message of the artifact protocol, as `artifactRuntime.ts` describes it. */
export type RuntimeMessage = { camox: string; channel?: string; [key: string]: unknown };

/** What the host page keeps on its `window` for the harness. */
type HostWindow = Window & {
  artifactHost: ArtifactHost;
  /** Every protocol message the artifact's runtime posted to the page, in order. */
  runtimeMessages: RuntimeMessage[];
  /** The internal paths the artifact navigated the page to. */
  navigations: string[];
};

/**
 * Headless Chromium, through Playwright's Chromium headless shell pinned to `playwright-core`'s
 * version (`pnpm --filter camox exec playwright-core install chromium-headless-shell`). Close it
 * in a `finally`: Playwright also closes it on SIGINT, SIGTERM and SIGHUP, and the browser exits
 * when its pipe to the test process closes.
 */
export function launchArtifactBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

let hostBundle: Promise<string> | null = null;

/**
 * The artifact host as a script for the host page, bundled from its source: it exposes
 * `connectArtifactHost` as `window.camoxArtifactHost`.
 */
function artifactHostScript() {
  hostBundle ??= build({
    input: fileURLToPath(new URL("./lib/artifactHost.ts", import.meta.url)),
    write: false,
    output: { format: "iife", name: "camoxArtifactHost" },
  }).then(({ output }) => output[0].code);
  return hostBundle;
}

/** JSON for an inline script: `<` is escaped so no value can close the script early. */
const scriptJson = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

export type OpenArtifactOptions = {
  /** The website's stylesheet, such as its theme tokens. The frame is 100% wide, 600px tall. */
  css?: string;
  /**
   * The website's body around the frame. The frame goes into the element with a `data-artifact`
   * attribute, or at the end of the body without one.
   */
  html?: string;
  /** How the frame loads its Artifact Document: inlined in `srcdoc`, or from its URL. */
  load?: "inline" | "url";
  /** The website's font links, which the Artifact Shell holds. */
  fontLinks?: string;
  /** The artifact's Artifact Data, inlined in its document or carried by its URL's fragment. */
  data?: ArtifactData;
  /** What the host shares with the artifact besides its data; `studio` is `null` by default. */
  state?: Partial<Omit<ArtifactHostState, "data">>;
  /** The artifact field's `size`. */
  size?: ArtifactHostOptions["size"];
  /** The browser context's viewport, color scheme, reduced motion and such. */
  context?: BrowserContextOptions;
};

/**
 * Opens a host page holding one artifact frame, loaded with `source` the way the website loads
 * it (sandboxed frame, Artifact Shell, artifact host connected), and resolves once the artifact's
 * runtime is ready on the host's channel. Close it when done; closing the browser also does.
 */
export async function openArtifact(
  browser: Browser,
  source: string,
  options: OpenArtifactOptions = {},
) {
  const { css = "", html = "", load = "inline", fontLinks = "", data = {} } = options;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...options.context,
  });
  try {
    const artifactPath = `${ARTIFACTS_PATH_PREFIX}${await artifactShellHash(fontLinks)}/${await artifactSourceHash(source)}`;
    const frameProps: ArtifactFrameProps =
      load === "inline"
        ? artifactFrameProps(source, { fontLinks, data })
        : artifactFrameProps(
            { artifactUrl: `${WEBSITE_ORIGIN}${artifactPath}`, title: artifactTitle(source) },
            { data },
          );
    const state: ArtifactHostState = { studio: null, ...options.state, data };
    const hostPage = `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; }
      iframe { display: block; width: 100%; height: 600px; border: 0; }
    </style>
    <style>${css}</style>
  </head>
  <body>
    ${html}
    <script>${await artifactHostScript()}</script>
    <script>
      (() => {
        const props = ${scriptJson(frameProps)};
        const frame = document.createElement("iframe");
        for (const name of ["sandbox", "allow", "title", "loading"]) frame.setAttribute(name, props[name]);
        if (props.srcDoc !== undefined) frame.srcdoc = props.srcDoc;
        else frame.src = props.src;
        window.runtimeMessages = [];
        window.navigations = [];
        window.addEventListener("message", (event) => {
          const message = event.data;
          if (event.source !== frame.contentWindow) return;
          if (!message || typeof message.camox !== "string") return;
          window.runtimeMessages.push(message);
        });
        (document.querySelector("[data-artifact]") ?? document.body).append(frame);
        window.artifactHost = camoxArtifactHost.connectArtifactHost(frame, ${scriptJson(state)}, {
          size: ${scriptJson(options.size ?? "fill")},
          onHeight: (height) => { frame.style.height = height + "px"; },
          navigate: (path) => window.navigations.push(path),
        });
      })();
    </script>
  </body>
</html>`;

    await context.route(`${WEBSITE_ORIGIN}/**`, (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: hostPage });
      }
      if (pathname === artifactPath) {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          headers: { "Content-Security-Policy": "sandbox allow-scripts" },
          body: artifactUrlDocument(source, fontLinks),
        });
      }
      return route.fulfill({ status: 404, body: "Not found" });
    });

    const page = await context.newPage();
    await page.goto(`${WEBSITE_ORIGIN}/`);
    await page.waitForFunction(() =>
      (window as unknown as HostWindow).runtimeMessages.some(
        (message) => message.camox === "ready",
      ),
    );
    const frame = await (await page.waitForSelector("iframe")).contentFrame();
    if (!frame) throw new Error("The artifact's frame has no document");
    return artifactHarness(page, frame, () => context.close());
  } catch (error) {
    await context.close();
    throw error;
  }
}

function artifactHarness(page: Page, frame: Frame, close: () => Promise<void>) {
  return {
    /** The website's page, which holds the artifact's frame. */
    page,
    /** The artifact's own frame, running its Artifact Document. */
    frame,
    /** The `<iframe>` element on the website's page, to screenshot what the artifact shows. */
    frameElement: page.locator("iframe"),
    /** The page's `ArtifactHost`, to drive the artifact as the website or the look document do. */
    host(): Promise<JSHandle<ArtifactHost>> {
      return page.evaluateHandle(() => (window as unknown as HostWindow).artifactHost);
    },
    /** Posts a protocol message to the artifact's runtime on the host's channel. */
    post(type: string, payload: Record<string, unknown> = {}) {
      return page.evaluate(
        ([type, payload]) => {
          const host = window as unknown as HostWindow;
          const ready = host.runtimeMessages.find((message) => message.camox === "ready");
          const frame = document.querySelector("iframe");
          frame?.contentWindow?.postMessage(
            { ...payload, camox: type, channel: ready?.channel },
            "*",
          );
        },
        [type, payload] as const,
      );
    },
    /** Every protocol message the artifact's runtime posted to the page so far, in order. */
    messages(): Promise<RuntimeMessage[]> {
      return page.evaluate(() => (window as unknown as HostWindow).runtimeMessages);
    },
    /** The first message of `type` the runtime posted from the `after`th one on, once it has. */
    async waitForMessage(type: string, { after = 0 }: { after?: number } = {}) {
      const handle = await page.waitForFunction(
        ([type, after]) =>
          (window as unknown as HostWindow).runtimeMessages
            .slice(after)
            .find((message) => message.camox === type),
        [type, after] as const,
      );
      return (await handle.jsonValue()) as RuntimeMessage;
    },
    /** The internal paths the artifact navigated the website's client router to. */
    navigations(): Promise<string[]> {
      return page.evaluate(() => (window as unknown as HostWindow).navigations);
    },
    close,
  };
}

export type OpenedArtifact = Awaited<ReturnType<typeof openArtifact>>;
