import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test, type TestContext } from "node:test";

import type { TSchema } from "@sinclair/typebox";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import { blockQueries, fileQueries, projectQueries } from "@/lib/queries";

import type { EditingOwner, Selection } from "../previewStore";

// Render the real sidebar; only replace leaves that need a rich-text engine or
// comment queries. The String editor stub types plain text into the field.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (
      specifier === "@/core/components/lexical/SidebarLexicalEditor" &&
      context.parentURL?.endsWith("/ItemFieldsEditor.tsx")
    ) {
      source = `export function SidebarLexicalEditor({ id, value, onChange }) {
        return React.createElement("textarea", {
          id,
          defaultValue: typeof value === "string" ? value : "",
          onInput: (event) => onChange(event.target.value),
        });
      }`;
    }
    if (specifier === "./AttachedComments" && context.parentURL?.endsWith("/PageEditorSidebar.tsx"))
      source = "export const AttachedComments = () => null";
    if (context.parentURL?.endsWith("/AssetFieldEditor.tsx")) {
      if (specifier === "./AssetLightbox") source = "export const AssetLightbox = () => null";
      if (specifier === "./AssetPickerModal") source = "export const AssetPickerModal = () => null";
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", "development");

const owner: EditingOwner = { kind: "page", pageId: 1 };
const BLOCK_ID = 7;
const ITEM_ID = 12;
const FILE_ID = 5;
const logo = { _fileId: FILE_ID };

type Write = { procedure: string; input: { id: number; content: Record<string, unknown> } };

async function renderSidebar(t: TestContext, selection: Selection) {
  const window = new Window({ url: "http://localhost/" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Element: window.Element,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    MutationObserver: window.MutationObserver,
    PointerEvent: window.PointerEvent,
    KeyboardEvent: window.KeyboardEvent,
    Event: window.Event,
    DataTransfer: window.DataTransfer,
    getComputedStyle: window.getComputedStyle.bind(window),
    ResizeObserver: window.ResizeObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { PageEditorSidebar } = await import("./PageEditorSidebar");
  const { PreviewEditingOwnerContext } = await import("../previewSelection");
  const { previewStore } = await import("../previewStore");
  const { CamoxAppProvider } = await import("../../provider/components/CamoxAppContext");
  const { createApp } = await import("../../../core/createApp");
  const { createBlock, Type } = await import("../../../core/createBlock");

  const definition = createBlock({
    id: "testimonial",
    title: "Testimonial",
    description: "Sidebar write fixture",
    content: {
      quote: Type.String({ default: "" }),
      logo: Type.Image({ title: "Logo" }),
      people: Type.Repeater({
        title: "People",
        content: { name: Type.String({ default: "" }), photo: Type.Image({ title: "Photo" }) },
        minItems: 1,
        maxItems: 5,
        toMarkdown: () => [],
      }),
    } as Record<string, TSchema>,
    component: () => null,
    toMarkdown: () => [],
  });
  const file = {
    id: FILE_ID,
    url: "https://cdn.test/logo.png",
    alt: "",
    filename: "logo.png",
    mimeType: "image/png",
  };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, {
    block: {
      id: BLOCK_ID,
      type: "testimonial",
      content: { quote: "Hello", logo, people: [{ _itemId: ITEM_ID }] },
      settings: {},
    },
    repeatableItems: [
      {
        id: ITEM_ID,
        blockId: BLOCK_ID,
        fieldName: "people",
        parentItemId: null,
        position: "a0",
        summary: "Ada",
        content: { name: "Ada", photo: logo },
        settings: {},
      },
    ],
    files: [file],
  } as never);
  client.setQueryData(fileQueries.get(FILE_ID).queryKey, file as never);
  client.setQueryData(projectQueries.getBySlug("site").queryKey, { id: 1 } as never);
  client.setQueryData(fileQueries.getUsageCount(FILE_ID).queryKey, { count: 3 } as never);

  const writes: Write[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace("/rpc/", "");
    const { json } = (await request.json()) as { json: Write["input"] };
    writes.push({ procedure, input: json });
    return Response.json({ json: null });
  });

  previewStore.send({ type: "viewDraftSite" });
  previewStore.send({ type: "selectTarget", ...owner, selection });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            projectSlug: "site",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
          }}
        >
          <CamoxAppProvider app={createApp({ blocks: [definition] })}>
            <PreviewEditingOwnerContext.Provider value={owner}>
              <PageEditorSidebar />
            </PreviewEditingOwnerContext.Provider>
          </CamoxAppProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
  });

  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "viewDraftSite" });
    await window.happyDOM.close();
  });

  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  return {
    host,
    writes,
    previewStore,
    settle,
    /** Types into the selected text field and waits for the debounced save. */
    async typeText(text: string) {
      const textarea = host.querySelector("textarea");
      assert.ok(textarea, "text field editor is rendered");
      await act(async () => {
        textarea.value = text;
        textarea.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
      await settle();
    },
    /** Unlinks the asset shown in the selected asset field view. */
    async unlinkAsset() {
      const unlink = host.querySelector("svg.lucide-x")?.closest("button");
      assert.ok(unlink, "asset card has an unlink button");
      await act(async () => unlink.click());
      await settle();
    },
  };
}

void test("block text field edits are saved to the block", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "block-field",
    blockId: BLOCK_ID,
    fieldName: "quote",
    fieldType: "String",
  });
  await sidebar.typeText("Great product");
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "blocks/updateContent",
      input: { id: BLOCK_ID, content: { quote: "Great product" } },
    },
  ]);
});

void test("repeater item text field edits are saved to the item", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "item-field",
    blockId: BLOCK_ID,
    itemId: ITEM_ID,
    fieldName: "name",
    fieldType: "String",
  });
  await sidebar.typeText("Grace");
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "repeatableItems/updateContent",
      input: { id: ITEM_ID, content: { name: "Grace" } },
    },
  ]);
});

void test("block asset field edits are saved to the block", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "block-field",
    blockId: BLOCK_ID,
    fieldName: "logo",
    fieldType: "Image",
  });
  assert.match(sidebar.host.textContent ?? "", /logo\.png/);
  await sidebar.unlinkAsset();
  assert.deepEqual(sidebar.writes, [
    { procedure: "blocks/updateContent", input: { id: BLOCK_ID, content: { logo: null } } },
  ]);
});

void test("repeater item asset field edits are saved to the item", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "item-field",
    blockId: BLOCK_ID,
    itemId: ITEM_ID,
    fieldName: "photo",
    fieldType: "Image",
  });
  assert.match(sidebar.host.textContent ?? "", /logo\.png/);
  await sidebar.unlinkAsset();
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "repeatableItems/updateContent",
      input: { id: ITEM_ID, content: { photo: null } },
    },
  ]);
});

void test("field edits are not sent while viewing the live site", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "block-field",
    blockId: BLOCK_ID,
    fieldName: "logo",
    fieldType: "Image",
  });
  await act(async () => sidebar.previewStore.send({ type: "viewLiveSite" }));
  await sidebar.unlinkAsset();
  assert.deepEqual(sidebar.writes, []);
});
