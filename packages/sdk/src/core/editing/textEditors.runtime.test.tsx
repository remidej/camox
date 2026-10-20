import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { initApiClient } from "../../lib/api-client";
import { StudioQueryClientProvider, testDraftScope } from "../../lib/draft-scope.fixtures";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import { TextEditorsContext } from "../hooks/textEditors";

// Exercise the real editable field. The harness substitutes only network/auth/iframe
// boundaries, the selection owner and Lexical's input surface.
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
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
      "../hooks/useIsEditable.ts": "export const useIsEditable = mode => mode === 'site'",
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

void test("a frame without text editors shows its text as the site does, and stays targetable", async () => {
  const block = createEditableBlock({
    id: "heading",
    title: "",
    description: "",
    content: (field) => ({ title: field.string({ default: "" }) }),
    toMarkdown: () => [],
    component: () => <block.Field name="title">{(props) => <h1 {...props} />}</block.Field>,
  });

  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  const client = new QueryClient();
  const render = (editors: boolean) =>
    act(async () =>
      root.render(
        <StudioQueryClientProvider client={client}>
          <NormalizedDataProvider files={[]} blocks={[]} repeatableItems={[]}>
            <TextEditorsContext value={editors}>
              <block._internal.Component
                mode="site"
                blockData={{
                  _id: "1",
                  type: "heading",
                  position: "a0",
                  content: { title: "Hello" },
                }}
              />
            </TextEditorsContext>
          </NormalizedDataProvider>
        </StudioQueryClientProvider>,
      ),
    );
  try {
    await render(false);
    const heading = host.querySelector("h1")!;
    assert.equal(heading.textContent, "Hello");
    assert.equal(heading.querySelector("[data-editor]"), null, "no editor starts");
    assert.equal(
      heading.getAttribute("data-camox-field-id"),
      "1__title",
      "overlays find the field",
    );

    await render(true);
    assert.equal(
      host.querySelector("h1"),
      heading,
      "selecting the frame keeps the field's element",
    );
    assert.equal(
      heading.querySelector("[data-editor]")?.textContent,
      "Hello",
      "and starts its editor",
    );
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
  }
});
