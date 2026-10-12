import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { initApiClient } from "../../lib/api-client";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import { artifactBlock, renderArtifactFrames } from "../artifact.fixtures";

// Render real block definitions through the studio's editing runtime. The harness substitutes
// only the network, auth, iframe and selection boundaries of the editable block, and lets each
// test turn Edit Mode on or off.
const selections: unknown[] = [];
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
  artifactEditMode: true,
  captureArtifactSelection: (selection: unknown) => selections.push(selection),
});
initApiClient("http://localhost:8788", "development");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith("/createEditableBlock.tsx"))
      return nextResolve(specifier, context);
    const modules: Record<string, string> = {
      "@/lib/auth": "export const useProjectSlug = () => 'test'",
      "@/features/navigation/navigation": "export const useLocation = () => '/'",
      "../../features/preview/components/Frame":
        "export const useFrame = () => ({window: globalThis.window ?? null})",
      "../hooks/useIsEditable.ts":
        "export const useIsEditable = mode => mode === 'site' && globalThis.artifactEditMode",
      "../../features/preview/previewSelection": `
        export const usePreviewSelection = () => globalThis.captureArtifactSelection;
        export const usePreviewTargetSelection = () => null;
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
  assert.equal(frames[0].getAttribute("srcdoc"), source);
  assert.equal(frames[0].getAttribute("title"), "Orbiting moons");
  assert.equal(frames[1].getAttribute("srcdoc"), "<title>Scene</title>");
  assert.equal(frames[1].getAttribute("title"), "Scene");
  for (const frame of frames) {
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
    assert.equal(frame.getAttribute("allow"), "fullscreen; clipboard-write");
    assert.equal(frame.getAttribute("loading"), "lazy");
  }
});

void test("the studio preview shows a placeholder for empty artifacts", () => {
  const frames = render({ slides: [{ scene: "" }] });
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    assert.equal(frame.getAttribute("title"), "Empty artifact");
    assert.match(frame.getAttribute("srcdoc") ?? "", /Empty artifact/);
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  }
});

/** Mounts the artifact block in the studio preview with Edit Mode on or off. */
async function mount(content: Record<string, unknown>, editMode: boolean) {
  Object.assign(globalThis, { artifactEditMode: editMode });
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <CompleteBlockEditingRuntimeProvider>
          <NormalizedDataProvider files={[]} repeatableItems={[]} blocks={[]}>
            <artifactBlock._internal.Component
              mode="site"
              blockData={{ _id: 4, type: "visual", position: "a0", content: content as never }}
            />
          </NormalizedDataProvider>
        </CompleteBlockEditingRuntimeProvider>
      </QueryClientProvider>,
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
  slides: [{ id: 12, content: { scene: "<title>Scene</title>" } }],
};

void test("in Edit Mode, clicking an artifact selects its field instead of reaching the frame", async () => {
  selections.length = 0;
  const preview = await mount(withItem, true);
  try {
    const [visual, scene] = preview.frames();
    assert.notEqual(preview.pointerTarget(visual), visual, "a layer covers the frame");
    await preview.click(preview.pointerTarget(visual));
    await preview.click(preview.pointerTarget(scene));
    assert.deepEqual(selections, [
      { type: "block-field", blockId: 4, fieldName: "visual", fieldType: "Artifact" },
      { type: "item-field", blockId: 4, itemId: 12, fieldName: "scene", fieldType: "Artifact" },
    ]);
  } finally {
    await preview.unmount();
  }
});

void test("in Edit Mode, an empty artifact's placeholder selects its field too", async () => {
  selections.length = 0;
  const preview = await mount({ slides: [] }, true);
  try {
    const [placeholder] = preview.frames();
    await preview.click(preview.pointerTarget(placeholder));
    assert.deepEqual(selections, [
      { type: "block-field", blockId: 4, fieldName: "visual", fieldType: "Artifact" },
    ]);
  } finally {
    await preview.unmount();
  }
});

void test("in Edit Mode, sidebar hover highlights the artifact", async () => {
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

void test("with Edit Mode off, the artifact frame receives pointer events and clicks select nothing", async () => {
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
