import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import {
  observeCanvasOverlays,
  type CanvasOverlayTarget,
} from "../../features/canvas/canvasOverlayGeometry";
import { previewStore } from "../../features/preview/previewStore";
import { closestRepeatableItem } from "../../features/preview/repeatableItemTargets";
import { initApiClient } from "../../lib/api-client";
import { NormalizedDataProvider } from "../../lib/normalized-data";

// Exercise the real editable repeater against React's Fragment refs. The harness
// substitutes only network/auth/iframe boundaries, the selection owner and
// Lexical's input surface (Lexical itself has dedicated DOM editing tests).
const selections: unknown[] = [];
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
  captureItemSelection: (selection: unknown) => selections.push(selection),
});
initApiClient("http://localhost:8788");
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
        export const usePreviewSelection = () => globalThis.captureItemSelection;
        export const usePreviewTargetSelection = () => null;
        export { PreviewEditingOwnerContext } from ${JSON.stringify(new URL("../../features/preview/previewSelection.ts", import.meta.url).href)};
      `,
      "../components/lexical/InlineLexicalEditor": `
        export const InlineLexicalEditor = props => React.createElement('span', null, props.externalState);
      `,
    };
    const body = modules[specifier];
    return body
      ? { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { createEditableBlock } = await import("./createEditableBlock");

const item = (id: string, label: string, value: string) => ({
  id,
  blockId: "3",
  parentItemId: null,
  fieldName: "specs",
  content: { label, value },
  settings: null,
  summary: "",
  position: `a${id}`,
  createdAt: 0,
  updatedAt: 0,
});

void test("editable repeatable items render the author's elements as-is and stay targetable", async () => {
  const block = createEditableBlock({
    id: "specs",
    title: "",
    description: "",
    content: (field) => ({
      specs: field.repeater({
        content: (field) => ({
          label: field.string({ default: "" }),
          value: field.string({ default: "" }),
        }),
        minItems: 1,
        maxItems: 10,
        toMarkdown: () => [],
      }),
    }),
    toMarkdown: () => [],
    component: () => (
      <dl>
        <block.Repeater name="specs">
          {(spec) => (
            <>
              <spec.Field name="label">{(props) => <dt {...props} />}</spec.Field>
              <dd>
                <spec.Field name="value">{(props) => <span {...props} />}</spec.Field>
              </dd>
            </>
          )}
        </block.Repeater>
      </dl>
    ),
  });

  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  const document = window.document as unknown as Document;
  let targets: CanvasOverlayTarget[] = [];
  const stop = observeCanvasOverlays(document, (next) => (targets = next));
  const itemTargets = () => targets.filter((target) => target.item);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <NormalizedDataProvider
            files={[]}
            blocks={[]}
            repeatableItems={[item("7", "Weight", "2 kg"), item("8", "Width", "40 cm")] as never}
          >
            <block._internal.Component
              mode="site"
              blockData={{
                _id: "3",
                type: "specs",
                position: "a0",
                content: { specs: [{ _itemId: "7" }, { _itemId: "8" }] } as never,
              }}
            />
          </NormalizedDataProvider>
        </QueryClientProvider>,
      ),
    );
    await window.happyDOM.waitUntilComplete();

    const dl = host.querySelector("dl")!;
    assert.deepEqual(
      Array.from(dl.children, (child) => child.localName),
      ["dt", "dd", "dt", "dd"],
      "no wrapper element between the list and its items",
    );
    const [firstLabel, firstValue, , secondValue] = Array.from(dl.children) as unknown as Element[];
    assert.equal(closestRepeatableItem(firstValue!)?.itemId, "7");
    assert.equal(closestRepeatableItem(firstValue!.firstElementChild!)?.itemId, "7");
    assert.equal(closestRepeatableItem(secondValue!)?.itemId, "8");
    assert.equal(closestRepeatableItem(dl as unknown as Element), undefined);

    assert.deepEqual(
      itemTargets().map((target) => target.item),
      [
        { blockId: "3", itemId: "7" },
        { blockId: "3", itemId: "8" },
      ],
    );
    assert.equal(itemTargets()[0]!.element, firstLabel);

    // Hovering any of an item's elements hovers the item.
    await act(async () => {
      firstValue!.dispatchEvent(new window.MouseEvent("mouseenter") as unknown as Event);
    });
    await window.happyDOM.waitUntilComplete();
    assert.deepEqual(
      targets.filter((target) => target.hovered).map((target) => target.item?.itemId),
      ["7"],
    );
    await act(async () => {
      firstValue!.dispatchEvent(new window.MouseEvent("mouseleave") as unknown as Event);
    });
    await window.happyDOM.waitUntilComplete();
    assert.deepEqual(
      targets.filter((target) => target.hovered),
      [],
    );

    // Commenting on an item's non-field element selects that item.
    await act(async () => {
      previewStore.send({ type: "enterEditMode" });
      previewStore.send({ type: "setCommentMode", enabled: true });
    });
    await act(async () => {
      (secondValue as unknown as HTMLElement).click();
    });
    assert.deepEqual(selections.at(-1), { type: "item", blockId: "3", itemId: "8" });
  } finally {
    await act(async () => previewStore.send({ type: "exitEditMode" }));
    stop();
    await act(async () => root.unmount());
    await window.happyDOM.close();
  }
});
