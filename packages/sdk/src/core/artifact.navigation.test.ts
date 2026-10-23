import assert from "node:assert/strict";
import { test } from "node:test";

import { createArtifactPage } from "./artifactProtocol.fixtures";
import { artifactFrameProps } from "./lib/artifact";
import { connectArtifactHost } from "./lib/artifactHost";

const srcDoc = artifactFrameProps("<!doctype html><title>Pricing</title><button></button>").srcDoc;

/** An artifact on a website page, recording where the page's router and new tabs go. */
async function artifactOnWebsite() {
  const harness = createArtifactPage();
  harness.page.happyDOM.setURL("https://example.com/features");
  const routed: string[] = [];
  const opened: unknown[][] = [];
  Object.defineProperty(harness.page, "open", {
    configurable: true,
    value: (...args: unknown[]) => {
      opened.push(args);
      return null;
    },
  });
  const frame = harness.addFrame();
  connectArtifactHost(frame, { studio: null }, { navigate: (path) => routed.push(path) });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  /** Calls `camox.navigate` as the artifact would, right after a real click or not. */
  async function navigate(href: string, { clicked }: { clicked: boolean }) {
    harness.activate(clicked);
    artifact.camox.navigate(href);
    await harness.settle();
  }
  return { navigate, routed, opened };
}

void test("right after a click, an artifact navigates to internal paths through the client router", async () => {
  const website = await artifactOnWebsite();
  await website.navigate("/pricing?plan=pro#faq", { clicked: true });
  await website.navigate("https://example.com/docs", { clicked: true });
  assert.deepEqual(website.routed, ["/pricing?plan=pro#faq", "/docs"]);
  assert.deepEqual(website.opened, []);
});

void test("right after a click, an artifact opens external URLs in a new tab", async () => {
  const website = await artifactOnWebsite();
  await website.navigate("https://camox.ai/blog", { clicked: true });
  assert.deepEqual(
    website.opened.map(([url, target]) => [url, target]),
    [["https://camox.ai/blog", "_blank"]],
  );
  assert.deepEqual(website.routed, []);
});

void test("without a click, an artifact can't navigate", async () => {
  const website = await artifactOnWebsite();
  await website.navigate("/pricing", { clicked: false });
  await website.navigate("https://camox.ai/blog", { clicked: false });
  assert.deepEqual(website.routed, []);
  assert.deepEqual(website.opened, []);
});

void test("an artifact can't navigate to scripts or other non-web URLs", async () => {
  const website = await artifactOnWebsite();
  await website.navigate("javascript:alert(1)", { clicked: true });
  await website.navigate("data:text/html,<p>hi</p>", { clicked: true });
  assert.deepEqual(website.routed, []);
  assert.deepEqual(website.opened, []);
});
