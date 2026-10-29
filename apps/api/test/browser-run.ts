import { env } from "cloudflare:workers";

import type { CaptureBatch, Captured, Capturer } from "../src/domains/looks/capture";

// Stands in for Browser Run's Chromium in integration tests that `vi.mock` the API's adapter
// (src/domains/looks/browser-run.ts): each batch goes to the fake Browser Run of the release
// fakes Worker (test/release-fakes.js), which the `BROWSER` binding reaches in tests.

type FakeBrowserRun = { capture(batch: CaptureBatch): Promise<Captured[]> };

/** The capturer every thread uses, in tests. */
export const fakeBrowserRun = (): Capturer => ({
  capture: (batch) => (env as unknown as { BROWSER: FakeBrowserRun }).BROWSER.capture(batch),
});

/** A capture the fake Browser Run was asked for, with the cookie it was given. */
export type RecordedCapture = {
  url: string;
  size: string;
  element?: string;
  delayMs?: number;
  cookie: { name: string; value: string; host: string };
};

export type BrowserRunFakes = {
  captures(pattern: string): Promise<RecordedCapture[]>;
  capturedImage(): Promise<string>;
  failCapturesOf(pattern: string, error: string, size?: string): Promise<void>;
  takeBrowserRunDownFor(host: string): Promise<void>;
  /** Makes captures of an element whose selector holds `pattern` cut, at `size` only when given. */
  cutCapturesOf(pattern: string, size?: string): Promise<void>;
};

export const browserRunFakes = (env as unknown as { RELEASE_FAKES: BrowserRunFakes }).RELEASE_FAKES;
