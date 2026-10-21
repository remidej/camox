import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { CanvasWorkspaceContext } from "../../features/canvas/canvasZoom";
import { previewStore, selectIsCanvasShown } from "../../features/preview/previewStore";
import { CamoxAppProvider } from "../../features/provider/components/CamoxAppContext";
import { initApiClient } from "../../lib/api-client";
import { StudioQueryClientProvider, testDraftScope } from "../../lib/draft-scope.fixtures";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import {
  artifactBlock,
  chartData,
  chartDataSeen,
  expectedFontLinks,
  fontDocument,
  mountArtifactFrames,
  mountChartFrames,
  renderArtifactFrames,
  renderChartFrames,
  srcDocHead,
} from "../artifact.fixtures";
import { createArtifactPage, type ArtifactWindow } from "../artifactProtocol.fixtures";
import { createApp } from "../createApp";
import { ArtifactsRunContext } from "../hooks/useArtifactHost";

// Render real block definitions through the studio's editing runtime. The harness substitutes
// only the network, auth, iframe and selection boundaries of the editable block. Showing the Canvas comes
// from the real preview store.
const selections: unknown[] = [];
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
  useTestCanvasShown: () => useSelector(previewStore, selectIsCanvasShown),
  captureArtifactSelection: (selection: unknown) => selections.push(selection),
});
initApiClient("http://localhost:8788", testDraftScope());
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith("/createEditableBlock.tsx"))
      return nextResolve(specifier, context);
    const modules: Record<string, string> = {
      "@/lib/auth": "export const useProjectSlug = () => 'test'",
      "@/features/navigation/navigation":
        "export const useLocation = () => '/'; export const useNavigate = () => () => {}",
      "../../features/preview/components/Frame":
        "export const useFrame = () => ({window: globalThis.window ?? null})",
      // Whether the Canvas shows comes from the real preview store; only the auth check is left out.
      "../hooks/useIsEditable.ts":
        "export const useIsEditable = mode => mode === 'site' && globalThis.useTestCanvasShown()",
      "../../features/preview/previewSelection": `
        export const usePreviewSelection = () => globalThis.captureArtifactSelection;
        export const usePreviewTargetSelection = () => null;
        export { PreviewEditingOwnerContext } from ${JSON.stringify(new URL("../../features/preview/previewSelection.ts", import.meta.url).href)};
      `,
    };
    const body = modules[specifier];
    return body
      ? { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { CompleteBlockEditingRuntimeProvider } = await import("./CompleteBlockEditingRuntime");

const source = `<!doctype html><title>Orbiting moons</title><svg></svg>`;

function render(content: Record<string, unknown>) {
  return renderArtifactFrames(content, CompleteBlockEditingRuntimeProvider);
}

void test("the studio preview renders artifacts as sandboxed frames holding their source", () => {
  const frames = render({ visual: source, slides: [{ scene: "<title>Scene</title>" }] });
  assert.equal(frames.length, 2);
  assert.ok(frames[0].getAttribute("srcdoc")?.endsWith(source));
  assert.equal(frames[0].getAttribute("title"), "Orbiting moons");
  assert.ok(frames[1].getAttribute("srcdoc")?.endsWith("<title>Scene</title>"));
  assert.equal(frames[1].getAttribute("title"), "Scene");
  for (const frame of frames) {
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
    assert.equal(frame.getAttribute("allow"), "fullscreen; clipboard-write");
    assert.equal(frame.getAttribute("loading"), "lazy");
  }
});

void test("the studio preview loads the document's font links into artifacts", () => {
  const app = createApp({ blocks: [], document: fontDocument });
  const frames = renderArtifactFrames(
    { visual: source, slides: [{ scene: "<title>Scene</title>" }] },
    ({ children }) => (
      <CamoxAppProvider app={app}>
        <CompleteBlockEditingRuntimeProvider>{children}</CompleteBlockEditingRuntimeProvider>
      </CamoxAppProvider>
    ),
  );
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    const head = srcDocHead(frame);
    assert.deepEqual(head.links, expectedFontLinks);
    assert.equal(head.otherEntries, 0);
  }
});

void test("the studio preview shows a placeholder for empty artifacts", () => {
  const frames = render({ slides: [{ scene: "" }] });
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    assert.equal(frame.getAttribute("title"), "Empty artifact");
    assert.match(frame.getAttribute("srcdoc") ?? "", /Empty artifact/);
    // Nothing runs in a placeholder, so it renders in the website's process, not one of its own.
    assert.doesNotMatch(frame.getAttribute("srcdoc") ?? "", /<script/);
    assert.equal(frame.getAttribute("sandbox"), "allow-same-origin");
  }
});

void test("where artifacts don't run, the studio preview shows their title in a still frame", () => {
  const frames = renderArtifactFrames(
    { visual: source, slides: [{ scene: "" }] },
    ({ children }) => (
      <ArtifactsRunContext value={false}>
        <CompleteBlockEditingRuntimeProvider>{children}</CompleteBlockEditingRuntimeProvider>
      </ArtifactsRunContext>
    ),
  );
  assert.equal(frames.length, 2);
  const [standIn, placeholder] = frames;
  const document = standIn.getAttribute("srcdoc") ?? "";
  assert.equal(standIn.getAttribute("title"), "Orbiting moons");
  assert.match(document, /<p>Orbiting moons<\/p>/);
  assert.doesNotMatch(document, /<script|<svg/, "neither the runtime nor the source loads");
  assert.equal(standIn.getAttribute("sandbox"), "allow-same-origin");
  assert.equal(placeholder.getAttribute("title"), "Empty artifact");
});

/** Mounts the artifact block in the studio with the Canvas shown or hidden. */
async function mount(content: Record<string, unknown>, editing: boolean) {
  previewStore.send({ type: editing ? "showCanvas" : "hideCanvas" });
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <StudioQueryClientProvider client={new QueryClient()}>
        <CompleteBlockEditingRuntimeProvider>
          <NormalizedDataProvider files={[]} repeatableItems={[]} blocks={[]}>
            <artifactBlock._internal.Component
              mode="site"
              blockData={{ _id: "4", type: "visual", position: "a0", content: content as never }}
            />
          </NormalizedDataProvider>
        </CompleteBlockEditingRuntimeProvider>
      </StudioQueryClientProvider>,
    ),
  );
  /** The element the pointer lands on over a frame: a layer on top of it, or the frame itself. */
  const pointerTarget = (frame: Element) =>
    frame.parentElement?.querySelector<HTMLElement>(":scope > [data-camox-artifact-layer]") ??
    (frame as HTMLElement);
  return {
    window,
    frames: () => [...host.querySelectorAll("iframe")],
    pointerTarget,
    async click(element: HTMLElement) {
      await act(async () => element.click());
    },
    async unmount() {
      await act(async () => root.unmount());
      await window.happyDOM.close();
    },
  };
}

const withItem = {
  visual: source,
  slides: [{ id: "12", content: { scene: "<title>Scene</title>" } }],
};

void test("on the Canvas, clicking an artifact selects its field instead of reaching the frame", async () => {
  selections.length = 0;
  const preview = await mount(withItem, true);
  try {
    const [visual, scene] = preview.frames();
    assert.notEqual(preview.pointerTarget(visual), visual, "a layer covers the frame");
    await preview.click(preview.pointerTarget(visual));
    await preview.click(preview.pointerTarget(scene));
    assert.deepEqual(selections, [
      { type: "block-field", blockId: "4", fieldName: "visual", fieldType: "Artifact" },
      { type: "item-field", blockId: "4", itemId: "12", fieldName: "scene", fieldType: "Artifact" },
    ]);
  } finally {
    await preview.unmount();
  }
});

void test("on the Canvas, an empty artifact's placeholder selects its field too", async () => {
  selections.length = 0;
  const preview = await mount({ slides: [] }, true);
  try {
    const [placeholder] = preview.frames();
    await preview.click(preview.pointerTarget(placeholder));
    assert.deepEqual(selections, [
      { type: "block-field", blockId: "4", fieldName: "visual", fieldType: "Artifact" },
    ]);
  } finally {
    await preview.unmount();
  }
});

void test("on the Canvas, sidebar hover highlights the artifact", async () => {
  const preview = await mount(withItem, true);
  try {
    const [visual] = preview.frames();
    const highlighted = () => visual.closest("[data-camox-hovered]") != null;
    assert.equal(highlighted(), false);
    await act(async () => {
      preview.window.postMessage({ type: "CAMOX_HOVER_FIELD", fieldId: "4__visual" }, "*");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(highlighted(), true);
  } finally {
    await preview.unmount();
  }
});

void test("with the Canvas hidden, the artifact frame receives pointer events and clicks select nothing", async () => {
  selections.length = 0;
  const preview = await mount(withItem, false);
  try {
    const [visual] = preview.frames();
    assert.equal(preview.pointerTarget(visual), visual, "nothing covers the frame");
    await preview.click(visual);
    assert.deepEqual(selections, []);
  } finally {
    await preview.unmount();
  }
});

/** Mounts the block in a page and loads each frame's document, as a browser would. */
async function mountInStudio(Providers: (props: { children: React.ReactNode }) => React.ReactNode) {
  const harness = createArtifactPage();
  const container = harness.page.document.createElement("div");
  harness.page.document.body.append(container);
  const { frames, unmount } = await mountArtifactFrames(
    { visual: source, slides: [{ scene: "<title>Scene</title>" }] },
    Providers,
    container as unknown as HTMLElement,
  );
  const artifacts = frames.map((frame) => harness.load(frame, frame.getAttribute("srcdoc") ?? ""));
  await harness.settle();
  return { harness, frames, artifacts, unmount };
}

function studioOf(artifact: ArtifactWindow) {
  const { studio } = artifact.camox;
  return studio && { ...studio };
}

void test("artifacts in the studio follow the Canvas", async () => {
  previewStore.send({ type: "showCanvas" });
  const { harness, artifacts, unmount } = await mountInStudio(CompleteBlockEditingRuntimeProvider);
  assert.equal(artifacts.length, 2);
  for (const artifact of artifacts) {
    assert.deepEqual(studioOf(artifact), { editing: true, canvas: false });
  }

  await act(async () => {
    previewStore.send({ type: "hideCanvas" });
  });
  await harness.settle();
  for (const artifact of artifacts) {
    assert.deepEqual(studioOf(artifact), { editing: false, canvas: false });
  }
  await unmount();
});

void test("artifacts on the Canvas know they are on the Canvas", async () => {
  previewStore.send({ type: "showCanvas" });
  const { artifacts, unmount } = await mountInStudio(({ children }) => (
    <CanvasWorkspaceContext
      value={{ workspaceKey: "test", mirrorCamera: () => () => {}, reveal: () => {} }}
    >
      <CompleteBlockEditingRuntimeProvider>{children}</CompleteBlockEditingRuntimeProvider>
    </CanvasWorkspaceContext>
  ));
  assert.equal(artifacts.length, 2);
  for (const artifact of artifacts) {
    assert.deepEqual(studioOf(artifact), { editing: true, canvas: true });
  }
  await unmount();
});

void test("in the studio preview, a frame sized to its content gets the height its artifact reports", async () => {
  previewStore.send({ type: "hideCanvas" });
  const { harness, frames, artifacts, unmount } = await mountInStudio(
    CompleteBlockEditingRuntimeProvider,
  );
  await act(async () => {
    for (const artifact of artifacts) harness.resize(artifact, 360);
    await harness.settle();
  });
  const [fill, content] = frames;
  assert.equal(content.style.height, "360px");
  assert.equal(fill.style.height, "", "a frame that fills its container keeps its own size");
  await unmount();
});

/** `camox.data` as seen by the artifact, copied out of its realm for comparison. */
function dataOf(artifact: ArtifactWindow) {
  return JSON.parse(JSON.stringify(artifact.camox.data));
}

void test("the studio preview inlines each artifact's Artifact Data in its frame", () => {
  const frames = renderChartFrames(chartData, CompleteBlockEditingRuntimeProvider);
  const harness = createArtifactPage();
  const [chart, ...bars] = frames.map((frame) =>
    harness.load(harness.addFrame(), frame.getAttribute("srcdoc") ?? ""),
  );
  assert.deepEqual(dataOf(chart), chartDataSeen);
  assert.deepEqual(bars.map(dataOf), [
    { label: "Q1", highlighted: true },
    { label: "Q2", highlighted: false },
  ]);
});

void test("editing a listed sibling field or setting updates camox.data without reloading the frame", async () => {
  previewStore.send({ type: "showCanvas" });
  const harness = createArtifactPage();
  const container = harness.page.document.createElement("div");
  harness.page.document.body.append(container);
  const preview = await mountChartFrames(
    chartData,
    CompleteBlockEditingRuntimeProvider,
    container as unknown as HTMLElement,
  );
  const [chartFrame, barFrame] = preview.frames();
  const srcDocs = preview.frames().map((frame) => frame.getAttribute("srcdoc"));
  const chart = harness.load(chartFrame, srcDocs[0] ?? "");
  const bar = harness.load(barFrame, srcDocs[1] ?? "");
  await harness.settle();
  const seen: { chart: unknown[]; bar: unknown[] } = { chart: [], bar: [] };
  chart.camox.onData((data) => seen.chart.push(JSON.parse(JSON.stringify(data))));
  bar.camox.onData((data) => seen.bar.push(JSON.parse(JSON.stringify(data))));

  const [first, second] = chartData.content.bars;
  const edited = {
    ...chartData,
    content: {
      ...chartData.content,
      headline: "Profit",
      bars: [{ ...first, settings: { highlighted: false } }, second],
    },
    settings: { accent: "blue" },
  };
  await preview.update(edited);
  await harness.settle();
  // Re-rendering with the same values notifies nothing.
  await preview.update(edited);
  await harness.settle();

  assert.deepEqual(seen.chart, [{ ...chartDataSeen, headline: "Profit", accent: "blue" }]);
  assert.deepEqual(seen.bar, [{ label: "Q1", highlighted: false }]);
  assert.equal(dataOf(chart).headline, "Profit");
  assert.deepEqual(
    preview.frames().map((frame) => frame.getAttribute("srcdoc")),
    srcDocs,
    "the frames keep their documents",
  );
  await preview.unmount();
});
