import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import * as React from "react";

import { initApiClient } from "../../lib/api-client";
import { renderArtifactFrames } from "../artifact.fixtures";

// Render real block definitions through the studio's editing runtime. The harness substitutes
// only the network, auth, iframe and selection boundaries of the editable block.
Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
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
      "../hooks/useIsEditable.ts": "export const useIsEditable = mode => mode === 'site'",
      "../../features/preview/previewSelection": `
        export const usePreviewSelection = () => () => {};
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
