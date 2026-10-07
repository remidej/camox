import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { initApiClient } from "../../lib/api-client";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import { createCollection } from "../createCollection";
import { Type } from "../lib/contentType";
import type { ReferenceRecord } from "../lib/reference";

// Exercise the actual editable scope, field and normalized provider. The harness
// substitutes only network/auth/iframe boundaries and Lexical's input surface
// (Lexical itself has dedicated DOM editing tests).
const editors: Array<{ onChange: (value: string) => void; externalState: unknown }> = [];
const selections: unknown[] = [];
const requests: Array<{ expectedVersion: number; content: Record<string, unknown> }> = [];
let source: ReferenceRecord;
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
  captureReferenceEditor: (props: (typeof editors)[number]) => editors.push(props),
  captureReferenceSelection: (selection: unknown) => selections.push(selection),
  editReferenceRecord: async (input: (typeof requests)[number]) => {
    requests.push(input);
    assert.equal(input.expectedVersion, source.version);
    source = { ...source, content: input.content, version: input.expectedVersion + 1 };
    return { id: source.id, draft: source.content, version: source.version };
  },
});
initApiClient("http://localhost:8788", "development");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith("/createEditableBlock.tsx"))
      return nextResolve(specifier, context);
    const modules: Record<string, string> = {
      "@/lib/auth": "export const useProjectSlug = () => 'test'",
      "@/features/navigation/navigation": "export const useLocation = () => '/'",
      "../../features/preview/components/Frame": "export const useFrame = () => ({window:null})",
      "../hooks/useIsEditable.ts": "export const useIsEditable = mode => mode === 'site'",
      "../hooks/useFieldSelection.ts": "export const useFieldSelection = () => false",
      "../hooks/useOverlayMessage.ts": "export const useOverlayMessage = () => false",
      "../../features/preview/previewSelection": `
        export const usePreviewSelection = () => globalThis.captureReferenceSelection;
        export const usePreviewTargetSelection = () => null;
      `,
      "../components/lexical/InlineLexicalEditor": `
        export const InlineLexicalEditor = props => {
          globalThis.captureReferenceEditor(props);
          return React.createElement('span', null, props.externalState);
        };
      `,
      "@/lib/queries": `
        const unused = () => ({mutationFn: () => {throw new Error('Must not mutate placement')}});
        export const blockMutations = {updateContent:unused};
        export const repeatableItemMutations = {updateContent:unused};
        export const collectionMutations = {edit: () => ({mutationFn: globalThis.editReferenceRecord})};
        export const collectionQueries = {
          record: (...parts) => ({queryKey:['camox','collections','record',...parts]}),
          records: (...parts) => ({queryKey:['camox','collections','records',...parts]}),
        };
        export const projectQueries = {getBySlug: () => ({queryKey:['project'],queryFn:()=>null})};
        export const pageQueries = {list: () => ({queryKey:['pages'],queryFn:()=>[]})};
      `,
    };
    const body = modules[specifier];
    return body
      ? { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { createEditableBlock } = await import("./createEditableBlock");
const { referencePickerFocus } = await import("../../features/preview/referencePickerFocus");

void test("editable reference occurrences write one source and retain placement selection and purple identity", async () => {
  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "",
    label: "name",
    content: { name: Type.String({ default: "" }) },
  });
  source = {
    id: "source-id",
    collectionId: "customers",
    label: "Source label",
    content: { name: "Before" },
    version: 1,
  };
  const clickHandlers: Array<(() => void) | undefined> = [];
  const block = createEditableBlock({
    id: "reference",
    title: "",
    description: "",
    content: { customer: Type.Reference(customers) },
    toMarkdown: (c) => [c.customer.name],
    component: () => (
      <block.Reference name="customer">
        {(customer) => (
          <section aria-label={customer.label}>
            <customer.Field name="name">
              {(props) => {
                clickHandlers.push(props.onClickCapture as (() => void) | undefined);
                return <h2 {...props} />;
              }}
            </customer.Field>
          </section>
        )}
      </block.Reference>
    ),
  });
  const client = new QueryClient();
  const render = (selected: string | null = source.id) =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <NormalizedDataProvider
          files={[]}
          repeatableItems={[]}
          blocks={[{ references: { customer: source } }]}
        >
          {[1, 2].map((blockId) => (
            <block._internal.Component
              key={blockId}
              mode="site"
              blockData={{
                _id: blockId,
                type: "reference",
                position: "a0",
                content: { customer: selected },
              }}
            />
          ))}
        </NormalizedDataProvider>
      </QueryClientProvider>,
    );
  const html = render();
  assert.match(html, /data-camox-field-id="1__customer__name"/);
  assert.match(html, /data-camox-field-id="2__customer__name"/);
  assert.equal((html.match(/data-camox-collection-record-id="source-id"/g) ?? []).length, 2);
  assert.match(html, /data-camox-overlay-mode="reference"/);
  assert.match(html, /data-camox-reference-label="Source label"/);
  clickHandlers[0]?.();
  assert.deepEqual(selections.at(-1), {
    type: "block-field",
    blockId: 1,
    fieldName: "customer",
    fieldType: "Reference",
  });
  editors[0].onChange("After");
  // Mutation execution is async; no timers or network are involved.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].expectedVersion, 1);
  assert.equal(source.content.name, "After");
  editors.length = 0;
  const updated = render();
  assert.equal((updated.match(/>After<\/span>/g) ?? []).length, 2);
  assert.deepEqual(
    editors.map((editor) => editor.externalState),
    ["After", "After"],
  );
  editors.length = 0;
  const unset = render(null);
  assert.match(unset, /data-camox-reference-placeholder/);
  assert.doesNotMatch(unset, /data-camox-collection-record-id|<h2/);
  assert.equal(editors.length, 0);
  assert.equal(requests.length, 1);
  client.clear();
});

void test("an unset reference placeholder names the collection and selects the reference field to link a record", async () => {
  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "",
    label: "name",
    content: { name: Type.String({ default: "" }) },
  });
  const block = createEditableBlock({
    id: "unset-reference",
    title: "",
    description: "",
    content: { customer: Type.Reference(customers) },
    toMarkdown: () => [],
    component: () => (
      <block.Reference name="customer">{(customer) => <h2>{customer.label}</h2>}</block.Reference>
    ),
  });
  const placement = (mode: "site" | "peek") => (
    <QueryClientProvider client={new QueryClient()}>
      <NormalizedDataProvider files={[]} repeatableItems={[]} blocks={[]}>
        <block._internal.Component
          mode={mode}
          blockData={{
            _id: 3,
            type: "unset-reference",
            position: "a0",
            content: { customer: null },
          }}
        />
      </NormalizedDataProvider>
    </QueryClientProvider>
  );

  const live = renderToStaticMarkup(placement("peek"));
  assert.match(live, /data-camox-viewport-block="3"[^>]*><\/div>$/, "live rendering stays empty");

  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(placement("site")));
    const placeholder = host.querySelector<HTMLElement>("[data-camox-reference-placeholder]");
    assert.ok(placeholder, "editable unset references render a placeholder");
    assert.equal(placeholder.textContent?.trim(), "Select Customers");
    assert.equal(referencePickerFocus.getSnapshot().context.fieldId, null);
    await act(async () => placeholder.click());
    assert.deepEqual(selections.at(-1), {
      type: "block-field",
      blockId: 3,
      fieldName: "customer",
      fieldType: "Reference",
    });
    assert.equal(
      referencePickerFocus.getSnapshot().context.fieldId,
      "3__customer",
      "the sidebar is asked to focus the record picker for this placement",
    );
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
  }
});
