import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createArtifactPage,
  VIEWPORT_HEIGHT,
  type ArtifactWindow,
} from "./artifactProtocol.fixtures";
import { artifactFrameProps } from "./lib/artifact";
import { connectArtifactHost } from "./lib/artifactHost";

const srcDoc = artifactFrameProps("<!doctype html><title>Orbit</title><svg></svg>").srcDoc;
const FRAME_HEIGHT = VIEWPORT_HEIGHT / 2;

/** A frame on a website page, with its artifact loaded, half as tall as the viewport. */
async function artifactOnPage(top: number) {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  harness.place(frame, top, FRAME_HEIGHT);
  const host = connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  return { harness, frame, host, artifact };
}

/** Subscribes to `camox.onViewport` and records what the artifact sees, copied out of its realm. */
function watchViewport(artifact: ArtifactWindow) {
  const seen: { progress: number; visibleRatio: number }[] = [];
  const unsubscribe = artifact.camox.onViewport(({ progress, visibleRatio }) =>
    seen.push({ progress, visibleRatio }),
  );
  return { seen, unsubscribe, latest: () => seen.at(-1) };
}

function cssProgress(artifact: ArtifactWindow) {
  return artifact.document.documentElement.style.getPropertyValue("--camox-progress");
}

void test("an artifact scrolling through the viewport sees its progress and visible ratio", async () => {
  const { harness, frame, artifact } = await artifactOnPage(VIEWPORT_HEIGHT);
  const viewport = watchViewport(artifact);
  await harness.settle();
  assert.deepEqual(viewport.latest(), { progress: 0, visibleRatio: 0 }, "below the fold");

  harness.scroll(frame, VIEWPORT_HEIGHT - FRAME_HEIGHT / 2);
  await harness.settle();
  assert.equal(viewport.latest()?.visibleRatio, 0.5, "half scrolled in");

  harness.scroll(frame, (VIEWPORT_HEIGHT - FRAME_HEIGHT) / 2);
  await harness.settle();
  assert.deepEqual(viewport.latest(), { progress: 0.5, visibleRatio: 1 }, "centered");
  assert.equal(cssProgress(artifact), "0.5");

  harness.scroll(frame, -FRAME_HEIGHT);
  await harness.settle();
  assert.deepEqual(viewport.latest(), { progress: 1, visibleRatio: 0 }, "scrolled out the top");
  assert.equal(cssProgress(artifact), "1");
});

void test("an artifact sees at most one viewport update per animation frame, and only changes", async () => {
  const { harness, frame, artifact } = await artifactOnPage(VIEWPORT_HEIGHT);
  const viewport = watchViewport(artifact);
  await harness.settle();
  const before = viewport.seen.length;

  harness.scroll(frame, VIEWPORT_HEIGHT / 2);
  harness.scroll(frame, VIEWPORT_HEIGHT / 4);
  harness.scroll(frame, 0);
  await harness.settle();
  assert.equal(viewport.seen.length, before + 1, "one update for a burst of scrolls");
  assert.deepEqual(viewport.latest(), { progress: 2 / 3, visibleRatio: 1 }, "the latest place");

  harness.scroll(frame, 0);
  await harness.settle();
  assert.equal(viewport.seen.length, before + 1, "no update when nothing changed");
});

void test("an artifact far from the viewport sees no updates while the page scrolls", async () => {
  const { harness, frame, artifact } = await artifactOnPage(VIEWPORT_HEIGHT * 3);
  const viewport = watchViewport(artifact);
  await harness.settle();
  const before = viewport.seen.length;
  harness.scroll(frame, VIEWPORT_HEIGHT * 2);
  await harness.settle();
  harness.scroll(frame, VIEWPORT_HEIGHT * 4);
  await harness.settle();
  assert.equal(viewport.seen.length, before);
});

void test("an artifact that never subscribes receives nothing while the page scrolls", async () => {
  const { harness, frame, artifact } = await artifactOnPage(VIEWPORT_HEIGHT);
  let received = 0;
  artifact.addEventListener("message", () => received++);
  harness.scroll(frame, 0);
  await harness.settle();
  harness.scroll(frame, -FRAME_HEIGHT / 2);
  await harness.settle();
  assert.equal(received, 0);
  assert.equal(cssProgress(artifact), "");
});

void test("an artifact stops seeing viewport updates once it unsubscribes", async () => {
  const { harness, frame, artifact } = await artifactOnPage(VIEWPORT_HEIGHT);
  const viewport = watchViewport(artifact);
  await harness.settle();
  viewport.unsubscribe();
  await harness.settle();
  const before = viewport.seen.length;
  let received = 0;
  artifact.addEventListener("message", () => received++);
  harness.scroll(frame, 0);
  await harness.settle();
  assert.equal(viewport.seen.length, before);
  assert.equal(received, 0);
});

void test("an artifact that subscribes before its frame connects still sees its viewport", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  harness.place(frame, (VIEWPORT_HEIGHT - FRAME_HEIGHT) / 2, FRAME_HEIGHT);
  const artifact = harness.load(frame, srcDoc);
  const viewport = watchViewport(artifact);
  await harness.settle();
  connectArtifactHost(frame, { studio: null });
  await harness.settle();
  assert.deepEqual(viewport.latest(), { progress: 0.5, visibleRatio: 1 });
});

void test("a disconnected host stops sending viewport updates", async () => {
  const { harness, frame, host, artifact } = await artifactOnPage(VIEWPORT_HEIGHT);
  const viewport = watchViewport(artifact);
  await harness.settle();
  host.disconnect();
  const before = viewport.seen.length;
  harness.scroll(frame, 0);
  await harness.settle();
  assert.equal(viewport.seen.length, before);
});
