import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { previewStore } from "../../features/preview/previewStore";
import { initApiClient } from "../../lib/api-client";
import { StudioQueryClientProvider, testDraftScope } from "../../lib/draft-scope.fixtures";
import { NormalizedDataProvider } from "../../lib/normalized-data";

// Exercise the real editable field and editability check. The harness substitutes only
// network/auth/iframe boundaries, the selection owner and Lexical's input surface.
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
initApiClient("http://localhost:8788", testDraftScope());
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/useIsEditable.ts") && specifier === "@/lib/auth") {
      const body = "export const useIsAuthenticated = () => true";
      return { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true };
    }
    if (!context.parentURL?.endsWith("/createEditableBlock.tsx"))
      return nextResolve(specifier, context);
    const modules: Record<string, string> = {
      "@/lib/auth": "export const useProjectUuid = () => 'test'",
      "@/features/navigation/navigation":
        "export const useLocation = () => '/'; export const useNavigate = () => () => {}",
      "../../features/preview/components/Frame":
        "export const useFrame = () => ({window: globalThis.window ?? null})",
      "../../features/preview/previewSelection": `
        export const usePreviewSelection = () => () => {};
        export const usePreviewTargetSelection = () => null;
        export { PreviewEditingOwnerContext } from ${JSON.stringify(new URL("../../features/preview/previewSelection.ts", import.meta.url).href)};
      `,
      "../components/lexical/InlineLexicalEditor": `
        export const InlineLexicalEditor = props =>
          React.createElement('span', {'data-editor': ''}, props.externalState);
      `,
    };
    const body = modules[specifier];
    return body
      ? { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { createEditableBlock } = await import("./createEditableBlock");
const { EditableSurfaceContext } = await import("../hooks/useIsEditable");

void test("an unselected Canvas Page shows its text as the site does, with no visual editing", async () => {
  const block = createEditableBlock({
    id: "heading",
    title: "",
    description: "",
    content: (field) => ({ title: field.string({ default: "" }) }),
    toMarkdown: () => [],
    toReact: () => <block.Field name="title">{(props) => <h1 {...props} />}</block.Field>,
    toTitle: () => "",
  });

  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  const client = new QueryClient();
  previewStore.send({ type: "showCanvas" });
  const render = (selected: boolean) =>
    act(async () =>
      root.render(
        <StudioQueryClientProvider client={client}>
          <NormalizedDataProvider files={[]} blocks={[]} repeatableItems={[]}>
            <EditableSurfaceContext value={selected}>
              <block._internal.Component
                mode="site"
                blockData={{
                  _id: "1",
                  type: "heading",
                  position: "a0",
                  content: { title: "Hello" },
                }}
              />
            </EditableSurfaceContext>
          </NormalizedDataProvider>
        </StudioQueryClientProvider>,
      ),
    );
  try {
    await render(false);
    const heading = host.querySelector("h1")!;
    assert.equal(heading.textContent, "Hello");
    assert.equal(heading.querySelector("[data-editor]"), null, "no editor starts");
    assert.equal(heading.getAttribute("data-camox-field-id"), null, "clicks can't target it");
    assert.equal(host.querySelector("[data-camox-block-id]"), null, "nor its block");

    await render(true);
    assert.equal(
      host.querySelector("h1"),
      heading,
      "selecting the frame keeps the field's element",
    );
    assert.equal(heading.getAttribute("data-camox-field-id"), "1__title", "makes it targetable");
    assert.equal(
      heading.querySelector("[data-editor]")?.textContent,
      "Hello",
      "and starts its editor",
    );
  } finally {
    await act(async () => root.unmount());
    previewStore.send({ type: "hideCanvas" });
    await window.happyDOM.close();
  }
});

void test("an editable block's wrapper leaves its background to the website's stylesheet", async () => {
  const block = createEditableBlock({
    id: "plain",
    title: "",
    description: "",
    content: () => ({}),
    toMarkdown: () => [],
    toReact: () => <p>Hi</p>,
    toTitle: () => "",
  });

  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  try {
    await act(async () =>
      root.render(
        <StudioQueryClientProvider client={new QueryClient()}>
          <NormalizedDataProvider files={[]} blocks={[]} repeatableItems={[]}>
            <EditableSurfaceContext value={true}>
              <block._internal.Component
                mode="site"
                blockData={{ _id: "1", type: "plain", position: "a0", content: {} }}
              />
            </EditableSurfaceContext>
          </NormalizedDataProvider>
        </StudioQueryClientProvider>,
      ),
    );
    const wrapper = host.querySelector("[data-camox-viewport-block]") as unknown as HTMLElement;
    assert.ok(wrapper.querySelector("p"), "the block renders inside its wrapper");
    assert.equal(wrapper.style.background, "");
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
  }
});
