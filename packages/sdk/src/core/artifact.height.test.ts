import assert from "node:assert/strict";
import { test } from "node:test";

import { createArtifactPage } from "./artifactProtocol.fixtures";
import { artifactFrameProps } from "./lib/artifact";
import { connectArtifactHost } from "./lib/artifactHost";

const srcDoc = artifactFrameProps("<!doctype html><title>Calculator</title><form></form>").srcDoc;

/** Connects a frame sized `size`, and records the heights its host applies. */
async function artifactSized(size: "fill" | "content") {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const heights: number[] = [];
  connectArtifactHost(
    frame,
    { studio: null },
    { size, onHeight: (height) => heights.push(height) },
  );
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  return { harness, artifact, heights };
}

void test("a frame sized to its content follows the artifact's height as it changes", async () => {
  const { harness, artifact, heights } = await artifactSized("content");
  harness.resize(artifact, 320);
  await harness.settle();
  assert.equal(heights.at(-1), 320);

  harness.resize(artifact, 480.4);
  await harness.settle();
  assert.equal(heights.at(-1), 481, "rounded up so the content never scrolls");

  const before = heights.length;
  harness.resize(artifact, 480.4);
  await harness.settle();
  assert.equal(heights.length, before, "no update when the height didn't change");
});

void test("a frame that fills its container is never resized by its artifact", async () => {
  const { harness, artifact, heights } = await artifactSized("fill");
  harness.resize(artifact, 320);
  await harness.settle();
  assert.deepEqual(heights, []);
});

void test("a reloaded artifact keeps sizing its frame to its content", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const heights: number[] = [];
  connectArtifactHost(
    frame,
    { studio: null },
    { size: "content", onHeight: (height) => heights.push(height) },
  );
  harness.load(frame, srcDoc);
  await harness.settle();
  const reloaded = harness.load(frame, srcDoc);
  await harness.settle();
  harness.resize(reloaded, 200);
  await harness.settle();
  assert.equal(heights.at(-1), 200);
});
