import assert from "node:assert/strict";
import { test } from "node:test";

import { createArtifactPage, type ArtifactWindow } from "./artifactProtocol.fixtures";
import { artifactDataFragment, artifactFrameProps } from "./lib/artifact";
import { connectArtifactHost } from "./lib/artifactHost";
import { ARTIFACT_RUNTIME } from "./lib/artifactRuntime";

const srcDoc = artifactFrameProps("<!doctype html><title>Orbit</title><svg></svg>").srcDoc;
const editing = { editing: true, canvas: false };

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
  assert.deepEqual(studioOf(artifact), { editing: true, canvas: false });
});

void test("an artifact that loaded before its host connected still sees the studio context", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  connectArtifactHost(frame, { studio: editing });
  await harness.settle();
  assert.deepEqual(studioOf(artifact), { editing: true, canvas: false });
});

void test("camox.studio follows the Canvas as it shows and hides", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const host = connectArtifactHost(frame, { studio: { editing: true, canvas: true } });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();

  host.update({ studio: { editing: false, canvas: true } });
  await harness.settle();
  assert.deepEqual(studioOf(artifact), { editing: false, canvas: true });

  host.update({ studio: { editing: true, canvas: true } });
  await harness.settle();
  assert.deepEqual(studioOf(artifact), { editing: true, canvas: true });
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
  connectArtifactHost(previewFrame, { studio: { editing: false, canvas: true } });
  const editingArtifact = harness.load(editingFrame, srcDoc);
  const previewArtifact = harness.load(previewFrame, srcDoc);
  await harness.settle();
  assert.deepEqual(studioOf(editingArtifact), { editing: true, canvas: false });
  assert.deepEqual(studioOf(previewArtifact), { editing: false, canvas: true });
});

void test("a reloaded artifact sees the latest studio context", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const host = connectArtifactHost(frame, { studio: editing });
  harness.load(frame, srcDoc);
  await harness.settle();
  host.update({ studio: { editing: false, canvas: false } });
  const reloaded = harness.load(frame, srcDoc);
  await harness.settle();
  assert.deepEqual(studioOf(reloaded), { editing: false, canvas: false });
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

const source = "<!doctype html><title>Gauge</title><svg></svg>";

/** Loads an artifact whose `srcDoc` inlines `data`, and records what its `onData` callback sees. */
async function loadWithData(data: Record<string, unknown>) {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const host = connectArtifactHost(frame, { studio: editing, data });
  const artifact = harness.load(frame, artifactFrameProps(source, { data }).srcDoc);
  // Subscribed as the source loads, before the frame connects.
  const seen: unknown[] = [];
  const unsubscribe = artifact.camox.onData((next) => seen.push(JSON.parse(JSON.stringify(next))));
  await harness.settle();
  return { harness, host, artifact, seen, unsubscribe };
}

void test("new Artifact Data reaches camox.data and onData callbacks", async () => {
  const { harness, host, artifact, seen } = await loadWithData({ label: "Speed", value: 3 });
  host.update({ studio: editing, data: { label: "Speed", value: 7 } });
  await harness.settle();
  assert.deepEqual(seen, [{ label: "Speed", value: 7 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(artifact.camox.data)), { label: "Speed", value: 7 });
});

void test("unchanged Artifact Data calls no onData callback", async () => {
  const { harness, host, seen } = await loadWithData({ label: "Speed" });
  host.update({ studio: { editing: false, canvas: false }, data: { label: "Speed" } });
  await harness.settle();
  assert.deepEqual(seen, []);
});

void test("an unsubscribed onData callback no longer runs", async () => {
  const { harness, host, seen, unsubscribe } = await loadWithData({ label: "Speed" });
  unsubscribe();
  host.update({ studio: editing, data: { label: "Torque" } });
  await harness.settle();
  assert.deepEqual(seen, []);
});

void test("Artifact Data that changed before the frame connected reaches the artifact", async () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const artifact = harness.load(
    frame,
    artifactFrameProps(source, { data: { label: "Old" } }).srcDoc,
  );
  connectArtifactHost(frame, { studio: null, data: { label: "New" } });
  await harness.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(artifact.camox.data)), { label: "New" });
});

/** What a frame loaded by URL fetches: the runtime and the source, without any inline data. */
const urlDocument = `<!doctype html><script>${ARTIFACT_RUNTIME}</script>${source}`;
const artifactUrl = "https://site.test/_camox/artifacts/shell/source";

/** `camox.data` as seen by the artifact, copied out of its realm for comparison. */
function dataOf(artifact: ArtifactWindow) {
  return JSON.parse(JSON.stringify(artifact.camox.data)) as unknown;
}

/** Loads the artifact by URL, with `fragment` after its `#`, and connects its host. */
async function loadByUrl(fragment: string, data?: Record<string, unknown>) {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const host = connectArtifactHost(frame, { studio: null, data });
  const artifact = harness.load(frame, urlDocument, { url: `${artifactUrl}${fragment}` });
  const seen: unknown[] = [];
  artifact.camox.onData((next) => seen.push(JSON.parse(JSON.stringify(next))));
  return { harness, host, artifact, seen };
}

void test("an artifact loaded by URL reads its starting Artifact Data from the fragment", async () => {
  const data = { label: "Débit <max> & 100%", link: { href: "/a#b?c=d", newTab: true } };
  const { artifact } = await loadByUrl(artifactDataFragment(data));
  assert.deepEqual(dataOf(artifact), {
    label: "Débit <max> & 100%",
    link: { href: "/a#b?c=d", newTab: true },
  });
});

void test("an artifact loaded by URL keeps its fragment's data after its source changes the fragment", () => {
  const harness = createArtifactPage();
  const frame = harness.addFrame();
  const routing = `<!doctype html><script>${ARTIFACT_RUNTIME}</script><script>location.hash = "#/settings"</script>`;
  const fragment = artifactDataFragment({ label: "Speed" });
  const artifact = harness.load(frame, routing, { url: `${artifactUrl}${fragment}` });
  assert.deepEqual(dataOf(artifact), { label: "Speed" });
});

void test("new Artifact Data reaches an artifact loaded by URL and its onData callbacks", async () => {
  const fragment = artifactDataFragment({ label: "Speed", value: 3 });
  const { harness, host, artifact, seen } = await loadByUrl(fragment, { label: "Speed", value: 3 });
  await harness.settle();
  host.update({ studio: null, data: { label: "Speed", value: 7 } });
  await harness.settle();
  assert.deepEqual(seen, [{ label: "Speed", value: 7 }]);
  assert.deepEqual(dataOf(artifact), { label: "Speed", value: 7 });
});

for (const [name, fragment] of [
  ["no fragment", ""],
  ["a fragment that isn't encoded JSON", "#%E0%A4%A"],
  ["a fragment that isn't JSON", "#/settings"],
  ["a fragment that isn't an object", `#${encodeURIComponent('"Speed"')}`],
]) {
  void test(`an artifact loaded by URL with ${name} sees empty Artifact Data`, async () => {
    const { artifact } = await loadByUrl(fragment);
    assert.deepEqual(dataOf(artifact), {});
  });
}
