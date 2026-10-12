import assert from "node:assert/strict";
import { test } from "node:test";

import { createArtifactPage, type ArtifactWindow } from "./artifactProtocol.fixtures";
import { artifactFrameProps } from "./lib/artifact";
import { connectArtifactHost } from "./lib/artifactHost";

const srcDoc = artifactFrameProps("<!doctype html><title>Orbit</title><svg></svg>").srcDoc;
const editing = { editMode: true, canvas: false };

/** `camox.studio` as seen by the artifact, copied out of its realm for comparison. */
function studioOf(artifact: ArtifactWindow) {
  const { studio } = artifact.camox;
  return studio && { ...studio };
}

void test("an artifact sees the studio context once its frame connects", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  connectArtifactHost(frame, { studio: editing });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  assert.deepEqual(studioOf(artifact), { editMode: true, canvas: false });
});

void test("an artifact that loaded before its host connected still sees the studio context", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  connectArtifactHost(frame, { studio: editing });
  await harness.settle();
  assert.deepEqual(studioOf(artifact), { editMode: true, canvas: false });
});

void test("camox.studio follows Edit Mode as it toggles", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const host = connectArtifactHost(frame, { studio: { editMode: true, canvas: true } });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();

  host.update({ studio: { editMode: false, canvas: true } });
  await harness.settle();
  assert.deepEqual(studioOf(artifact), { editMode: false, canvas: true });

  host.update({ studio: { editMode: true, canvas: true } });
  await harness.settle();
  assert.deepEqual(studioOf(artifact), { editMode: true, canvas: true });
});

void test("camox.studio is null on the website", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  assert.equal(artifact.camox.studio, null);
});

void test("each artifact on a page sees only its own host's context", async () => {
  const harness = createArtifactPage();
  const editingFrame = harness.addFrame();
  const previewFrame = harness.addFrame();
  connectArtifactHost(editingFrame, { studio: editing });
  connectArtifactHost(previewFrame, { studio: { editMode: false, canvas: true } });
  const editingArtifact = harness.load(editingFrame, srcDoc);
  const previewArtifact = harness.load(previewFrame, srcDoc);
  await harness.settle();
  assert.deepEqual(studioOf(editingArtifact), { editMode: true, canvas: false });
  assert.deepEqual(studioOf(previewArtifact), { editMode: false, canvas: true });
});

void test("a reloaded artifact sees the latest studio context", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const host = connectArtifactHost(frame, { studio: editing });
  harness.load(frame, srcDoc);
  await harness.settle();
  host.update({ studio: { editMode: false, canvas: false } });
  const reloaded = harness.load(frame, srcDoc);
  await harness.settle();
  assert.deepEqual(studioOf(reloaded), { editMode: false, canvas: false });
});

void test("a disconnected host no longer connects its artifact", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const host = connectArtifactHost(frame, { studio: editing });
  harness.load(frame, srcDoc);
  await harness.settle();
  host.disconnect();
  const reloaded = harness.load(frame, srcDoc);
  await harness.settle();
  assert.equal(reloaded.camox.studio, null);
});
