import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NavigationProvider } from "../features/navigation/navigation";
import { initApiClient } from "../lib/api-client";
import { AuthContext } from "../lib/auth";
import { NormalizedDataProvider } from "../lib/normalized-data";
import { createBlock } from "./createBlock";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("https://api.example.test");

const source = `<!doctype html><html><head><title>  Orbiting   moons </title></head><body><svg></svg></body></html>`;

const block = createBlock({
  id: "visual",
  title: "Visual",
  description: "",
  content: (field) => ({
    heading: field.string({ default: "Heading" }),
    visual: field.artifact({ size: "fill", title: "Visual" }),
    slides: field.repeater({
      content: (field) => ({ scene: field.artifact({ size: "content" }) }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: () => [],
    }),
  }),
  toMarkdown: () => [],
  component: () => (
    <>
      <block.Artifact name="visual">{(props) => <iframe {...props} />}</block.Artifact>
      <block.Repeater name="slides">
        {(item) => <item.Artifact name="scene">{(props) => <iframe {...props} />}</item.Artifact>}
      </block.Repeater>
    </>
  ),
});

function render(content: Record<string, unknown>) {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider
        value={{ projectSlug: "test" } as React.ContextType<typeof AuthContext>}
      >
        <NavigationProvider>
          <NormalizedDataProvider files={[]} repeatableItems={[]} blocks={[]}>
            <block._internal.Component
              mode="site"
              blockData={{ _id: 1, type: "visual", position: "a0", content: content as never }}
            />
          </NormalizedDataProvider>
        </NavigationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  return [...window.document.querySelectorAll("iframe")];
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

void test("the artifact schema is a size-limited string that remembers its size", () => {
  const { visual, slides } = block._internal.contentSchema.properties as Record<string, any>;
  assert.equal(visual.type, "string");
  assert.equal(visual.fieldType, "Artifact");
  assert.equal(visual.maxLength, 256 * 1024);
  assert.equal(visual.size, "fill");
  assert.equal(visual.title, "Visual");
  assert.equal(slides.items.properties.scene.size, "content");
  assert.equal(
    createBlock({
      id: "with-default",
      title: "",
      description: "",
      content: (field) => ({ visual: field.artifact({ size: "fill", default: source }) }),
      toMarkdown: () => [],
      component: () => null,
    })._internal.getInitialContent().visual,
    source,
  );
});
