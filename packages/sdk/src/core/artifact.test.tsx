import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";

import { NavigationProvider } from "../features/navigation/navigation";
import { initApiClient } from "../lib/api-client";
import { AuthContext } from "../lib/auth";
import { renderArtifactFrames } from "./artifact.fixtures";
import { createBlock } from "./createBlock";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("https://api.example.test");

const source = `<!doctype html><html><head><title>  Orbiting   moons </title></head><body><svg></svg></body></html>`;

function render(content: Record<string, unknown>) {
  return renderArtifactFrames(content, ({ children }) => (
    <AuthContext.Provider value={{ projectSlug: "test" } as React.ContextType<typeof AuthContext>}>
      <NavigationProvider>{children}</NavigationProvider>
    </AuthContext.Provider>
  ));
}

void test("an artifact renders as a sandboxed frame holding its source", () => {
  const [frame] = render({ visual: source, slides: [] });
  assert.equal(frame.getAttribute("srcdoc"), source);
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame.getAttribute("allow"), "fullscreen; clipboard-write");
  assert.equal(frame.getAttribute("title"), "Orbiting moons");
  assert.equal(frame.getAttribute("loading"), "lazy");
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
  assert.equal(frames[2].getAttribute("srcdoc"), "<title>Second</title>");
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
