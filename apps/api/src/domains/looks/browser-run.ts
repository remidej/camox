import playwright, { type Browser, type BrowserContext, type Page } from "@cloudflare/playwright";

import { errorField, timed } from "../../lib/timing";
import type { Bindings } from "../../types";
import {
  type Capture,
  type CaptureChecks,
  type Captured,
  type CaptureCookie,
  type Capturer,
  LOOK_SIZES,
} from "./capture";
import { elementClip, fittingJpeg } from "./framing";

// Browser Run's Chromium, driven through a Playwright Browser Session (#717): one session per
// thread, kept alive between `look` calls and reconnected by its ID, the connection dropped at
// the end of each call, so a redeploy reaches the next call. No automated test drives it: tests
// swap this module for the fake Browser Run (test/browser-run.ts).

/** Where a thread keeps its browser session's ID. */
const SESSION_KEY = "camox.look-session";

/**
 * How long Browser Run keeps a thread's session with nobody connected: it bridges the agent's
 * design rounds, which are tens of seconds apart. A tuning value.
 */
const KEEP_ALIVE_MS = 120_000;

/**
 * How long a document may take to load, then to mark itself ready, which waits for its Artifacts:
 * a 3D one takes a few seconds under Browser Run's software WebGL. Tuning values.
 */
const LOAD_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 15_000;

/** How long any other step of a capture may take, such as the screenshot. A tuning value. */
const STEP_TIMEOUT_MS = 10_000;

/**
 * How long a whole capture may take beyond its delay, so a step that hangs fails its own capture
 * and never the call. A tuning value, above the steps' own timeouts.
 */
const CAPTURE_TIMEOUT_MS = LOAD_TIMEOUT_MS + READY_TIMEOUT_MS + STEP_TIMEOUT_MS;

/** What the lightweight document marks itself with once it rendered and its Artifacts loaded. */
const READY_SELECTOR = "html[data-camox-ready]";

/** How long a ready document is left to settle, for entrance animations. A tuning value. */
const SETTLE_MS = 500;

/**
 * Browser Run for the thread whose storage is `storage`: captures each batch in the thread's
 * browser session, each capture in its own context, so cookies, viewports and listeners never
 * mix and a failing capture leaves the others.
 */
export const browserRun = (env: Bindings, storage: DurableObjectStorage): Capturer => ({
  async capture(batch, span) {
    const browser = await browserOf(env, storage);
    try {
      return await Promise.all(
        batch.captures.map((capture) =>
          timed(
            "look.capture",
            { ...span, size: capture.size, element: capture.element !== undefined },
            () => captureIn(browser, batch.cookie, capture),
            (captured) => ("error" in captured ? { captureError: captured.error } : {}),
          ),
        ),
      );
    } finally {
      // A session `connect()`ed to only disconnects: it stays alive for the next call.
      await browser.close().catch(() => {});
    }
  },
});

/** The thread's browser session, reconnected, or a new one when it expired or there's none. */
async function browserOf(env: Bindings, storage: DurableObjectStorage): Promise<Browser> {
  const known = await storage.get<string>(SESSION_KEY);
  if (known) {
    try {
      return await playwright.connect(env.BROWSER, known);
    } catch {
      // The session expired: acquire another.
    }
  }
  const { sessionId } = await playwright.acquire(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
  await storage.put(SESSION_KEY, sessionId);
  return playwright.connect(env.BROWSER, sessionId);
}

/** One capture, in its own context, failing alone when it takes too long. */
async function captureIn(
  browser: Browser,
  cookie: CaptureCookie,
  capture: Capture,
): Promise<Captured> {
  let context: BrowserContext | undefined;
  let givenUp = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Captured>((resolve) => {
    timer = setTimeout(
      () => {
        givenUp = true;
        resolve({ error: "The capture took too long, and was given up." });
      },
      CAPTURE_TIMEOUT_MS + (capture.delayMs ?? 0),
    );
  });
  try {
    return await Promise.race([
      timedOut,
      // Its own errors are its result: it may still fail after the capture was given up.
      (async (): Promise<Captured> => {
        try {
          context = await browser.newContext({
            viewport: LOOK_SIZES[capture.size],
            deviceScaleFactor: 1,
          });
          // A context that came after the capture was given up has nobody else to close it.
          if (givenUp) await context.close();
          context.setDefaultTimeout(STEP_TIMEOUT_MS);
          return await captureWith(context, cookie, capture);
        } catch (error) {
          return { error: errorField(error) };
        }
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    // Closing the context also ends a step still running after the capture was given up.
    await context?.close().catch(() => {});
  }
}

async function captureWith(
  context: BrowserContext,
  cookie: CaptureCookie,
  capture: Capture,
): Promise<Captured> {
  const viewport = LOOK_SIZES[capture.size];
  // A `url` and no `domain` make the cookie the host's only.
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      url: `https://${cookie.host}`,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const checks = watch(page);
  const response = await page.goto(capture.url, {
    waitUntil: "load",
    timeout: LOAD_TIMEOUT_MS,
  });
  if (response && !response.ok()) {
    return { error: `The page answered ${response.status()}.` };
  }
  try {
    await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS });
  } catch (error) {
    if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
    return {
      error:
        `The page wasn't ready after ${READY_TIMEOUT_MS / 1000} seconds: something on it, ` +
        "such as an Artifact, never finished loading.",
    };
  }
  await page.waitForTimeout(SETTLE_MS + (capture.delayMs ?? 0));
  // Run in the page, which has a DOM: as a string, since the API's types have none.
  checks.overflow = await page.evaluate<boolean>(
    "document.documentElement.scrollWidth > document.documentElement.clientWidth",
  );
  const { image, cut } = capture.element
    ? await elementImage(page, capture.element, viewport.height)
    : {
        image: await fittingJpeg((quality) => page.screenshot({ type: "jpeg", quality })),
        cut: false,
      };
  return {
    image: { data: image.toString("base64"), mimeType: "image/jpeg" },
    cut,
    checks,
  };
}

/** The element `selector` names, cut at a few screens of `screenHeight`. */
async function elementImage(page: Page, selector: string, screenHeight: number) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error("The element isn't on the page.");
  const scrollY = await page.evaluate<number>("window.scrollY");
  const { clip, cut } = elementClip(box, scrollY, screenHeight);
  const image = await fittingJpeg((quality) =>
    page.screenshot({ type: "jpeg", quality, fullPage: true, clip }),
  );
  return { image, cut };
}

/** Records what the page reports as it loads: its errors and the requests that failed. */
function watch(page: Page): CaptureChecks {
  const checks: CaptureChecks = { errors: [], failedRequests: [], overflow: false };
  page.on("console", (message) => {
    if (message.type() === "error") checks.errors.push(message.text());
  });
  page.on("pageerror", (error) => checks.errors.push(error.message));
  page.on("requestfailed", (request) =>
    checks.failedRequests.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) {
      checks.failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  return checks;
}
