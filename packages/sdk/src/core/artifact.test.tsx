import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { act } from "react";

import { NavigationProvider } from "../features/navigation/navigation";
import { CamoxAppProvider } from "../features/provider/components/CamoxAppContext";
import { initApiClient } from "../lib/api-client";
import { AuthContext } from "../lib/auth";
import { testDraftScope } from "../lib/draft-scope.fixtures";
import {
  chartBlock,
  chartData,
  chartDataSeen,
  expectedFontLinks,
  fontDocument,
  mountArtifactFrames,
  renderArtifactFrames,
  renderChartFrames,
  srcDocHead,
} from "./artifact.fixtures";
import { createArtifactPage, type ArtifactWindow } from "./artifactProtocol.fixtures";
import { createApp } from "./createApp";
import { createBlock } from "./createBlock";
import { ArtifactStudioContext } from "./hooks/useArtifactHost";
import type { ArtifactStudio } from "./lib/artifactHost";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("https://api.example.test", testDraftScope());

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

void test("a frame sized to its content gets the height its artifact reports", async () => {
  const harness = createArtifactPage();
  const container = harness.page.document.createElement("div");
  harness.page.document.body.append(container);
  const { frames, unmount } = await mountArtifactFrames(
    { visual: source, slides: [{ scene: source }] },
    Website,
    container as unknown as HTMLElement,
  );
  const [fill, content] = frames;
  const visual = harness.load(fill, fill.getAttribute("srcdoc") ?? "");
  const scene = harness.load(content, content.getAttribute("srcdoc") ?? "");
  await act(() => harness.settle());
  await act(async () => {
    harness.resize(visual, 240);
    harness.resize(scene, 240);
    await harness.settle();
  });
  assert.equal(content.style.height, "240px");
  assert.equal(fill.style.height, "", "a frame that fills its container keeps its own size");
  await unmount();
});

void test("artifacts rendered as on the website see the studio they're placed in", async () => {
  assert.deepEqual(await mountedStudio({ editing: false, canvas: true }), {
    editing: false,
    canvas: true,
  });
  assert.equal(await mountedStudio(null), null);
});

/** `camox.data` as seen by the artifact, copied out of its realm for comparison. */
function dataOf(artifact: ArtifactWindow) {
  return JSON.parse(JSON.stringify(artifact.camox.data));
}

void test("an artifact sees its Artifact Data from the first render, before any message", () => {
  const frames = renderChartFrames(chartData, Website);
  const harness = createArtifactPage();
  const [chartArtifact, ...barArtifacts] = frames.map((frame) =>
    harness.load(harness.addFrame(), frame.getAttribute("srcdoc") ?? ""),
  );
  assert.deepEqual(dataOf(chartArtifact), chartDataSeen);
  assert.equal(chartArtifact.document.title, "Revenue </script><p>up");
  assert.deepEqual(barArtifacts.map(dataOf), [
    { label: "Q1", highlighted: true },
    { label: "Q2", highlighted: false },
  ]);
});

void test("an artifact without data sees an empty object", () => {
  const [frame] = render({ visual: source, slides: [] });
  const harness = createArtifactPage();
  const artifact = harness.load(harness.addFrame(), frame.getAttribute("srcdoc") ?? "");
  assert.deepEqual(dataOf(artifact), {});
});

void test("an artifact's definition describes its Artifact Data as JSON Schema", () => {
  // Definitions sync as JSON.
  const { properties } = JSON.parse(JSON.stringify(chartBlock._internal.contentSchema));
  const text = { type: "string" };
  assert.deepEqual(properties.chart.data, ["headline", "cta", "photo", "accent"]);
  assert.deepEqual(properties.chart.dataSchema, {
    type: "object",
    properties: {
      headline: { type: "string", title: "Headline" },
      cta: {
        type: "object",
        properties: { text, href: text, newTab: { type: "boolean" } },
        required: ["text", "href", "newTab"],
        additionalProperties: false,
      },
      photo: {
        type: "object",
        title: "Photo",
        properties: { url: text, alt: text },
        required: ["url", "alt"],
        additionalProperties: false,
      },
      accent: { type: "string", enum: ["blue", "red"] },
    },
    required: ["headline", "cta", "photo", "accent"],
    additionalProperties: false,
  });
  assert.deepEqual(properties.bars.items.properties.bar.dataSchema, {
    type: "object",
    properties: { label: text, highlighted: { type: "boolean" } },
    required: ["label", "highlighted"],
    additionalProperties: false,
  });
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

void test("an artifact's document holds the runtime, font links, Artifact Data, then its source", () => {
  const app = createApp({ blocks: [], document: fontDocument });
  const [frame] = renderChartFrames(chartData, ({ children }) => (
    <Website>
      <CamoxAppProvider app={app}>{children}</CamoxAppProvider>
    </Website>
  ));
  const srcDoc = frame.getAttribute("srcdoc") ?? "";
  const positions = [
    srcDoc.indexOf("<script>"),
    srcDoc.indexOf("<link"),
    srcDoc.indexOf('<script type="application/json" data-camox-data>'),
    srcDoc.indexOf(chartData.content.chart),
  ];
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  assert.deepEqual(srcDocHead(frame).links, expectedFontLinks);
  const artifact = createArtifactPage().load(createArtifactPage().addFrame(), srcDoc);
  assert.deepEqual(dataOf(artifact), chartDataSeen);
});
