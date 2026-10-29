import type { SpanFields } from "../../lib/timing";

// What `look` asks of a browser: capture these documents, return their images and checks. Browser
// Run's Chromium does it in production (browser-run.ts); tests swap in a fake (test/browser-run.ts).

/** The sizes `look` captures at, by name: a desktop screen and a phone's. */
export const LOOK_SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

export type LookSize = keyof typeof LOOK_SIZES;

/** One capture: a document at one size, and what of it to capture. */
export type Capture = {
  /** The document to load: the website's lightweight document (`/_camox/look`). */
  url: string;
  size: LookSize;
  /**
   * The CSS selector of the element to capture, cut at two screens of `size`. Without one, the
   * capture is the document's first screen.
   */
  element?: string;
  /** How long to wait after the document is ready and settled, in milliseconds. */
  delayMs?: number;
};

/** The cookie each capture of a batch carries: set for `host` only, never its subdomains. */
export type CaptureCookie = { name: string; value: string; host: string };

export type CaptureBatch = { cookie: CaptureCookie; captures: Capture[] };

/** What the page said beside its image: its errors, the requests that failed, and overflow. */
export type CaptureChecks = {
  /** Console errors and uncaught page errors, in the order they came. */
  errors: string[];
  /** The requests that failed or answered an error status, each with why. */
  failedRequests: string[];
  /** Whether the document is wider than the viewport: content overflows horizontally. */
  overflow: boolean;
};

/** A capture's image, or why that capture alone failed. */
export type Captured =
  | {
      image: { data: string; mimeType: "image/jpeg" };
      /** Whether the element was taller than two screens, so the image shows its top only. */
      cut: boolean;
      checks: CaptureChecks;
    }
  | { error: string };

/**
 * A browser that captures batches: one result per capture, in order, a failing capture leaving
 * the others. It throws only when the browser can't be reached at all.
 */
export type Capturer = {
  capture(batch: CaptureBatch, span: SpanFields): Promise<Captured[]>;
};
