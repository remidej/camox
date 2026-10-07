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
import { blockQueries, collectionQueries, fileQueries, projectQueries } from "@/lib/queries";

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

type Write = { procedure: string; input: Record<string, unknown> };

const ACME = "acme";
const acmeContent = {
  name: "Acme",
  quote: "Great",
  featured: false,
  logo: {
    url: "https://cdn.test/acme.png",
    alt: "",
    filename: "acme.png",
    mimeType: "image/png",
    _fileId: "9",
  },
};
const acme = {
  id: ACME,
  collectionId: "customers",
  label: "Acme",
  version: 3,
  content: acmeContent,
};

async function renderSidebar(
  t: TestContext,
  selection: Selection,
  options: { company?: string | null } = {},
) {
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
  const { createCollection, Type: CollectionType } = await import("../../../core/createCollection");
  const { CollectionItemModalProvider, useCollectionItemModal } =
    await import("../../content/CollectionItemModalContext");

  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "Sidebar record fixture",
    content: {
      name: CollectionType.String({ title: "Name" }),
      quote: CollectionType.String({ title: "Quote" }),
      featured: CollectionType.Boolean({ default: false, title: "Featured" }),
      logo: CollectionType.Image({ title: "Logo" }),
    },
    label: "name",
  });

  const definition = createBlock({
    id: "testimonial",
    title: "Testimonial",
    description: "Sidebar write fixture",
    content: {
      quote: Type.String({ default: "" }),
      logo: Type.Image({ title: "Logo" }),
      company: Type.Reference(customers, { title: "Company", required: true }),
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
  const company = options.company === undefined ? ACME : options.company;
  client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, {
    block: {
      id: BLOCK_ID,
      type: "testimonial",
      content: { quote: "Hello", logo, people: [{ _itemId: ITEM_ID }], company },
      settings: {},
      references: { company: company === ACME ? acme : null },
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
  const records = [{ id: ACME, label: "Acme", status: "published", version: 3 }];
  client.setQueryData(collectionQueries.records("site", "customers").queryKey, records as never);

  const writes: Write[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace("/rpc/", "");
    const { json } = (await request.json()) as { json: Write["input"] };
    // Record saves refetch the block and record list; answer from the seeded cache.
    if (procedure === "blocks/get") {
      return Response.json({ json: client.getQueryData(blockQueries.get(BLOCK_ID).queryKey) });
    }
    if (procedure === "collectionDefinitions/listRecords") return Response.json({ json: records });
    writes.push({ procedure, input: json });
    if (procedure === "collectionDefinitions/editRecord") {
      const { id, expectedVersion, content } = json as {
        id: string;
        expectedVersion: number;
        content: Record<string, unknown>;
      };
      return Response.json({ json: { id, version: expectedVersion + 1, draft: content } });
    }
    return Response.json({ json: null });
  });

  previewStore.send({ type: "viewDraftSite" });
  previewStore.send({ type: "selectTarget", ...owner, selection });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let modal!: ReturnType<typeof useCollectionItemModal>;
  function ModalProbe() {
    modal = useCollectionItemModal();
    return null;
  }
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
          <CamoxAppProvider app={createApp({ blocks: [definition], collections: [customers] })}>
            <CollectionItemModalProvider onRouteTargetClose={() => {}}>
              <PreviewEditingOwnerContext.Provider value={owner}>
                <PageEditorSidebar />
              </PreviewEditingOwnerContext.Provider>
              <ModalProbe />
            </CollectionItemModalProvider>
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

  const crumbs = () =>
    [...host.querySelectorAll('nav[aria-label="Selection path"] li')].map((li) =>
      li.textContent?.trim(),
    );
  const button = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('button,[role="switch"]')].find(
      (element) =>
        (element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.id) === name,
    );

  return {
    host,
    client,
    writes,
    previewStore,
    settle,
    crumbs,
    modalOpened: () => modal.target != null,
    selection: () => previewStore.getSnapshot().context.editingContext?.selection ?? null,
    text: () => host.textContent ?? "",
    /** Clicks a button by accessible name and lets the selection re-render. */
    async click(name: string) {
      const element = button(name);
      assert.ok(element, `missing button: ${name}`);
      await act(async () => element.click());
      await settle();
    },
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
    /** Flips the switch shown in the selected boolean field view. */
    async toggle() {
      const toggle = host.querySelector<HTMLElement>('[role="switch"]');
      assert.ok(toggle, "boolean field editor is rendered");
      await act(async () => toggle.click());
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

const recordField = (recordFieldName: string, recordFieldType: "String" | "Boolean") =>
  ({
    type: "record-field",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
    recordFieldName,
    recordFieldType,
  }) as const;

void test("the block field list shows the label of the linked record", async (t) => {
  const sidebar = await renderSidebar(t, { type: "block", blockId: BLOCK_ID });
  assert.match(sidebar.text(), /Company\s*Acme/);
  assert.doesNotMatch(sidebar.text(), /Required/);
});

void test("an unset required reference says which collection it expects in the field list", async (t) => {
  const sidebar = await renderSidebar(t, { type: "block", blockId: BLOCK_ID }, { company: null });
  assert.match(sidebar.text(), /No Customers linked/);
  assert.match(sidebar.text(), /Required/);
});

void test("clicking the record card opens the record view with a shared header, badge and field rows", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "block-field",
    blockId: BLOCK_ID,
    fieldName: "company",
    fieldType: "Reference",
  });
  await sidebar.click("Open Acme");
  assert.deepEqual(sidebar.selection(), {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
  });
  assert.equal(sidebar.modalOpened(), false, "the page editor no longer opens the edit modal");
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Company", "Acme"]);
  const header = sidebar.host.querySelector("[data-shared-record]");
  assert.ok(header, "the record view explains the record is shared");
  assert.match(header.textContent ?? "", /Shared · Customers/);
  assert.match(header.textContent ?? "", /everywhere/);
  assert.match(sidebar.text(), /Published/);
  for (const row of [/Name\s*Acme/, /Quote\s*Great/, /Featured\s*Off/, /Logo\s*acme\.png/]) {
    assert.match(sidebar.text(), row);
  }
  assert.ok(!sidebar.host.querySelector("[data-record-card]"), "the link is managed one level up");
});

void test("breadcrumbs step up from a record field to the record, the reference field and the block", async (t) => {
  const sidebar = await renderSidebar(t, recordField("quote", "String"));
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Company", "Acme", "Quote"]);
  const recordCrumb = [...sidebar.host.querySelectorAll("nav li > button")].find(
    (element) => element.textContent === "Acme",
  );
  assert.match(recordCrumb?.className ?? "", /purple/, "the record crumb is purple");

  await sidebar.click("Acme");
  assert.deepEqual(sidebar.selection(), {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
  });
  await sidebar.click("Company");
  assert.deepEqual(sidebar.selection(), {
    type: "block-field",
    blockId: BLOCK_ID,
    fieldName: "company",
    fieldType: "Reference",
  });
  assert.ok(sidebar.host.querySelector("[data-record-card]"), "back in the reference field view");
  await sidebar.click("Testimonial");
  assert.deepEqual(sidebar.selection(), { type: "block", blockId: BLOCK_ID });
});

void test("record text field edits are saved to the record with its expected version", async (t) => {
  const sidebar = await renderSidebar(t, recordField("quote", "String"));
  await sidebar.typeText("Superb");
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "collectionDefinitions/editRecord",
      input: {
        projectSlug: "site",
        collectionId: "customers",
        id: ACME,
        expectedVersion: 3,
        content: { ...acmeContent, quote: "Superb" },
      },
    },
  ]);
  assert.deepEqual(sidebar.selection(), recordField("quote", "String"));
});

void test("record boolean field edits are saved to the record", async (t) => {
  const sidebar = await renderSidebar(t, recordField("featured", "Boolean"));
  await sidebar.toggle();
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.content]),
    [["collectionDefinitions/editRecord", { ...acmeContent, featured: true }]],
  );
});

void test("record field edits are not sent while viewing the live site", async (t) => {
  const sidebar = await renderSidebar(t, recordField("quote", "String"));
  await act(async () => sidebar.previewStore.send({ type: "viewLiveSite" }));
  await sidebar.typeText("Superb");
  assert.deepEqual(sidebar.writes, []);
});

void test("a record selection falls back to the reference field view once the record is unlinked", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
  });
  assert.ok(sidebar.host.querySelector("[data-shared-record]"));
  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      block: {
        ...bundle.block,
        content: { ...bundle.block.content, company: null },
        references: { company: null },
      },
    }));
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), {
    type: "block-field",
    blockId: BLOCK_ID,
    fieldName: "company",
    fieldType: "Reference",
  });
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Company"]);
  assert.ok(!sidebar.host.querySelector("[data-shared-record]"));
  assert.ok(sidebar.host.querySelector("button[aria-haspopup]"), "the picker is shown again");
});
