import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";

import { NavigationProvider } from "../features/navigation/navigation";
import { CamoxAppProvider } from "../features/provider/components/CamoxAppContext";
import { initApiClient } from "../lib/api-client";
import { AuthContext } from "../lib/auth";
import {
  expectedFontLinks,
  fontDocument,
  mountArtifactFrames,
  renderArtifactFrames,
  srcDocHead,
} from "./artifact.fixtures";
import { createArtifactPage } from "./artifactProtocol.fixtures";
import { createApp } from "./createApp";
import { createBlock } from "./createBlock";
import { ArtifactStudioContext } from "./hooks/useArtifactHost";
import type { ArtifactStudio } from "./lib/artifactHost";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("https://api.example.test");

const source = `<!doctype html><html><head><title>  Orbiting   moons </title></head><body><svg></svg></body></html>`;

function Website({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{ projectSlug: "test" } as React.ContextType<typeof AuthContext>}>
      <NavigationProvider>{children}</NavigationProvider>
    </AuthContext.Provider>
  );
}

function render(content: Record<string, unknown>) {
  return renderArtifactFrames(content, Website);
}

/** Mounts the block as on the website, inside `studio`, and returns what its artifact sees. */
async function mountedStudio(studio: ArtifactStudio | null) {
  const harness = createArtifactPage();
  const container = harness.page.document.createElement("div");
  harness.page.document.body.append(container);
  const { frames, unmount } = await mountArtifactFrames(
    { visual: source, slides: [] },
    ({ children }) => (
      <Website>
        <ArtifactStudioContext value={studio}>{children}</ArtifactStudioContext>
      </Website>
    ),
    container as unknown as HTMLElement,
  );
  const artifact = harness.load(frames[0], frames[0].getAttribute("srcdoc") ?? "");
  await harness.settle();
  const seen = artifact.camox.studio;
  await unmount();
  return seen && { ...seen };
}

void test("an artifact renders as a sandboxed frame holding its source", () => {
  const [frame] = render({ visual: source, slides: [] });
  assert.ok(frame.getAttribute("srcdoc")?.endsWith(source));
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame.getAttribute("allow"), "fullscreen; clipboard-write");
  assert.equal(frame.getAttribute("title"), "Orbiting moons");
  assert.equal(frame.getAttribute("loading"), "lazy");
});

void test("an artifact's source runs after the camox runtime", async () => {
  const probe = `<title>Probe</title><script>document.body.dataset.camox = typeof window.camox</script>`;
  const [frame] = render({ visual: probe, slides: [] });
  const harness = createArtifactPage();
  const artifact = harness.load(harness.addFrame(), frame.getAttribute("srcdoc") ?? "");
  assert.equal(artifact.document.body.dataset.camox, "object");
  assert.equal(artifact.document.title, "Probe");
});

void test("an artifact without a title is called Untitled artifact", () => {
  for (const visual of ["<p>No head</p>", "<title>   </title><p>Blank</p>"]) {
    const [frame] = render({ visual, slides: [] });
    assert.equal(frame.getAttribute("title"), "Untitled artifact");
  }
});

void test("repeatable items render their own artifacts", () => {
  const frames = render({
    visual: source,
    slides: [{ scene: "<title>First</title>" }, { scene: "<title>Second</title>" }],
  });
  assert.deepEqual(
    frames.map((frame) => frame.getAttribute("title")),
    ["Orbiting moons", "First", "Second"],
  );
  assert.ok(frames[2].getAttribute("srcdoc")?.endsWith("<title>Second</title>"));
  assert.equal(frames[2].getAttribute("sandbox"), "allow-scripts");
});

void test("an empty artifact renders nothing on the website", () => {
  assert.deepEqual(
    render({ slides: [{ scene: "" }, {}] }).map((frame) => frame.getAttribute("title")),
    [],
  );
});

void test("an artifact's default source is its block's initial content", () => {
  const withDefault = createBlock({
    id: "with-default",
    title: "",
    description: "",
    content: (field) => ({ visual: field.artifact({ size: "fill", default: source }) }),
    toMarkdown: () => [],
    component: () => null,
  });
  const withoutDefault = createBlock({
    id: "without-default",
    title: "",
    description: "",
    content: (field) => ({ visual: field.artifact({ size: "fill" }) }),
    toMarkdown: () => [],
    component: () => null,
  });
  assert.equal(withDefault._internal.getInitialContent().visual, source);
  assert.equal(withoutDefault._internal.getInitialContent().visual, "");
});

void test("artifacts rendered as on the website see the studio they're placed in", async () => {
  assert.deepEqual(await mountedStudio({ editMode: false, canvas: true }), {
    editMode: false,
    canvas: true,
  });
  assert.equal(await mountedStudio(null), null);
});

void test("an artifact loads the document's font links, and no other head entries", () => {
  const app = createApp({ blocks: [], document: fontDocument });
  const frames = renderArtifactFrames(
    { visual: source, slides: [{ scene: "<title>Scene</title>" }] },
    ({ children }) => (
      <Website>
        <CamoxAppProvider app={app}>{children}</CamoxAppProvider>
      </Website>
    ),
  );
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    const head = srcDocHead(frame);
    assert.deepEqual(head.links, expectedFontLinks);
    assert.equal(head.otherEntries, 0);
    assert.notEqual(head.title, "Website");
  }
});
