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
import { referencePickerFocus } from "../referencePickerFocus";

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
    if (
      context.parentURL?.endsWith("/AssetFieldEditor.tsx") ||
      context.parentURL?.endsWith("/MultipleAssetFieldEditor.tsx")
    ) {
      if (specifier === "./AssetLightbox") source = "export const AssetLightbox = () => null";
      // The picker stub offers one library file, with the extra metadata the API returns.
      if (specifier === "./AssetPickerModal") {
        source = `export function AssetPickerModal({ open, mode, onSelectSingle, onSelectMultiple }) {
          if (!open) return null;
          const file = ${JSON.stringify({
            id: 5,
            url: "https://cdn.test/logo.png",
            alt: "",
            filename: "logo.png",
            mimeType: "image/png",
            size: 1200,
            projectId: 1,
            blobId: "blob-5",
          })};
          return React.createElement("button", {
            type: "button",
            onClick: () => (mode === "single" ? onSelectSingle(file) : onSelectMultiple([file])),
          }, "Pick logo.png");
        }`;
      }
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
const ADA = "ada";
const ada = {
  id: ADA,
  collectionId: "people",
  label: "Ada Lovelace",
  version: 4,
  content: { name: "Ada Lovelace", role: "CTO" },
};
const acmeContent = {
  name: "Acme",
  quote: "Great",
  contact: ADA as string | null,
  featured: false,
  logo: {
    url: "https://cdn.test/acme.png",
    alt: "",
    filename: "acme.png",
    mimeType: "image/png",
    _fileId: "9",
  },
  gallery: [
    {
      url: "https://cdn.test/team.png",
      alt: "Team",
      filename: "team.png",
      mimeType: "image/png",
      _fileId: "8",
    },
  ],
};
const acme = {
  id: ACME,
  collectionId: "customers",
  label: "Acme",
  version: 3,
  content: acmeContent,
  // Records placed by the block resolve the records they link (the second hop).
  references: { contact: ada },
};

const GLOBEX = "globex";
const CREATED = "created";
const INITECH = "initech";
const listedRecords = [
  acme,
  { ...acme, id: GLOBEX, label: "Globex", version: 1, content: { ...acmeContent, name: "Globex" } },
  {
    ...acme,
    id: INITECH,
    label: "Initech",
    version: 2,
    content: { ...acmeContent, name: "Initech" },
  },
];

async function renderSidebar(
  t: TestContext,
  selection: Selection,
  options: {
    company?: string | null;
    fileUsage?: number;
    logos?: string[];
    /** The repeater item's own reference and reference list. */
    sponsor?: string | null;
    partners?: string[];
    /** The records the block's query-backed list resolved to, in result order. */
    recent?: string[];
  } = {},
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
    SubmitEvent: window.SubmitEvent,
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
  const { createBlock } = await import("../../../core/createBlock");
  const { createCollection } = await import("../../../core/createCollection");
  const { CollectionItemModalProvider, useCollectionItemModal } =
    await import("../../content/CollectionItemModalContext");
  const { ContentCollectionItemModal } = await import("../../content/ContentCollection");

  const people = createCollection({
    id: "people",
    title: "People",
    description: "Linked from customers",
    content: (field) => ({
      name: field.string({ title: "Name" }),
      role: field.string({ title: "Role" }),
    }),
    label: "name",
  });
  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "Sidebar record fixture",
    content: (field) => ({
      name: field.string({ title: "Name" }),
      quote: field.string({ title: "Quote" }),
      contact: field.reference(people, { title: "Contact" }),
      featured: field.boolean({ default: false, title: "Featured" }),
      logo: field.image({ title: "Logo" }),
      gallery: field.imageList({ title: "Gallery" }),
    }),
    label: "name",
  });

  const definition = createBlock({
    id: "testimonial",
    title: "Testimonial",
    description: "Sidebar write fixture",
    content: (field): Record<string, TSchema> => ({
      quote: field.string({ default: "" }),
      logo: field.image({ title: "Logo" }),
      company: field.reference(customers, { title: "Company", required: true }),
      logos: field.referenceList(customers, { title: "Logos", maxItems: 3 }),
      recent: field.referenceList(customers, {
        title: "Recent",
        query: { orderBy: { name: "asc" }, limit: 3 },
      }),
      people: field.repeater({
        title: "People",
        content: (field) => ({
          name: field.string({ default: "" }),
          photo: field.image({ title: "Photo" }),
          sponsor: field.reference(customers, { title: "Sponsor" }),
          partners: field.referenceList(customers, { title: "Partners", maxItems: 3 }),
        }),
        minItems: 1,
        maxItems: 5,
        toMarkdown: () => [],
      }),
    }),
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
  const logos = options.logos ?? [];
  const sponsor = options.sponsor ?? null;
  const partners = options.partners ?? [];
  const linked = (ids: string[]) =>
    ids.flatMap((id) => listedRecords.filter((record) => record.id === id));
  client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, {
    block: {
      id: BLOCK_ID,
      type: "testimonial",
      content: { quote: "Hello", logo, people: [{ _itemId: ITEM_ID }], company, logos },
      settings: {},
      references: {
        company: company === ACME ? acme : null,
        logos: linked(logos),
        recent: linked(options.recent ?? []),
      },
    },
    repeatableItems: [
      {
        id: ITEM_ID,
        blockId: BLOCK_ID,
        fieldName: "people",
        parentItemId: null,
        position: "a0",
        summary: "Ada",
        content: { name: "Ada", photo: logo, sponsor, partners },
        settings: {},
        references: {
          sponsor: linked(sponsor ? [sponsor] : [])[0] ?? null,
          partners: linked(partners),
        },
      },
    ],
    files: [file],
  } as never);
  client.setQueryData(fileQueries.get(FILE_ID).queryKey, file as never);
  client.setQueryData(projectQueries.getBySlug("site").queryKey, { id: 1 } as never);
  // By default every file is used elsewhere, so unlinking never offers to delete it.
  for (const id of [FILE_ID, 8, 9]) {
    client.setQueryData(fileQueries.getUsageCount(id).queryKey, {
      count: options.fileUsage ?? 3,
    } as never);
  }
  let records = [
    { id: ACME, label: "Acme", status: "published", version: 3 },
    { id: GLOBEX, label: "Globex", status: "draft", version: 1 },
    { id: INITECH, label: "Initech", status: "modified", version: 2 },
  ];
  client.setQueryData(collectionQueries.records("site", "customers").queryKey, records as never);
  client.setQueryData(collectionQueries.records("site", "people").queryKey, [
    { id: ADA, label: "Ada Lovelace", status: "published", version: 4 },
  ] as never);
  client.setQueryData(collectionQueries.get("site", "customers").queryKey, {
    collectionId: "customers",
    title: "Customers",
    description: "",
    label: "name",
    contentSchema: JSON.parse(JSON.stringify(customers._internal.contentSchema)),
  } as never);

  const writes: Write[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace("/rpc/", "");
    const { json } = (await request.json()) as { json: Write["input"] };
    // Record saves refetch the block and record list; answer from the seeded cache.
    if (procedure === "blocks/get") {
      return Response.json({ json: client.getQueryData(blockQueries.get(BLOCK_ID).queryKey) });
    }
    if (procedure === "collectionDefinitions/listRecords") return Response.json({ json: records });
    if (procedure === "collectionDefinitions/getRecord") {
      const record = listedRecords.find(({ id }) => id === (json as { id: string }).id);
      return Response.json({
        json: record && { id: record.id, version: record.version, draft: record.content },
      });
    }
    writes.push({ procedure, input: json });
    if (procedure === "collectionDefinitions/createRecord") {
      const content = (json as { content: Record<string, unknown> }).content;
      records = [
        ...records,
        { id: CREATED, label: String(content.name), status: "draft", version: 1 },
      ];
      return Response.json({ json: { id: CREATED, version: 1, draft: content } });
    }
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
          <CamoxAppProvider
            app={createApp({ blocks: [definition], collections: [customers, people] })}
          >
            <CollectionItemModalProvider onRouteTargetClose={() => {}}>
              <PreviewEditingOwnerContext.Provider value={owner}>
                <PageEditorSidebar />
              </PreviewEditingOwnerContext.Provider>
              <ModalProbe />
              <ContentCollectionItemModal projectSlug="site" />
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
    /** The labels and names of the records the preview renders for the logo list. */
    /** The labels of the records the preview renders for the item's partner list. */
    previewPartners: () =>
      (
        client.getQueryData(blockQueries.get(BLOCK_ID).queryKey) as {
          repeatableItems: { references: { partners: { label: string }[] } }[];
        }
      ).repeatableItems[0]!.references.partners.map((record) => record.label),
    previewLogos: () =>
      (
        client.getQueryData(blockQueries.get(BLOCK_ID).queryKey) as {
          block: { references: { logos: { label: string; content: { name: string } }[] } };
        }
      ).block.references.logos.map((record) => `${record.label}: ${record.content.name}`),
    /** Whether a button with this accessible name is on screen (dialogs included). */
    hasButton: (name: string) => button(name) != null,
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
    /** Opens the record picker, as the keyboard does. */
    async openPicker() {
      const trigger = host.querySelector<HTMLElement>("button[aria-haspopup]");
      assert.ok(trigger, "the record picker is shown");
      await act(async () => {
        trigger.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
          }) as unknown as KeyboardEvent,
        );
      });
    },
    /** Labels (with publication badges) of the records the open picker offers. */
    options: () =>
      [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent),
    async search(value: string) {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search items"]');
      assert.ok(input, "search input is open");
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
      });
    },
    async pick(label: string) {
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (element) => element.textContent?.startsWith(label),
      );
      assert.ok(option, `missing option: ${label}`);
      await act(async () => option.click());
      await settle();
    },
    /** Submits the open create-record form and waits for the save. */
    async submitCreateForm() {
      const form = document.querySelector<HTMLTextAreaElement>("#collection-name")?.closest("form");
      assert.ok(form, "the create form is open");
      await act(async () => {
        form.dispatchEvent(
          new window.SubmitEvent("submit", {
            bubbles: true,
            cancelable: true,
          }) as unknown as Event,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
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

const recordField = (
  recordFieldName: string,
  recordFieldType: "String" | "Boolean" | "Image" | "ImageList",
) =>
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

void test("clicking the record card opens the record view with its field rows and no shared header", async (t) => {
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
  assert.ok(
    !sidebar.host.querySelector("[data-shared-record]"),
    "a single reference's record view has no shared header",
  );
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
  assert.doesNotMatch(recordCrumb?.className ?? "", /purple/, "the sidebar has no purple");

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
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Company", "Acme"]);
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

const pickedLogo = {
  url: "https://cdn.test/logo.png",
  alt: "",
  filename: "logo.png",
  mimeType: "image/png",
  size: 1200,
  _fileId: "5",
};

void test("record image edits are saved to the record as asset snapshots", async (t) => {
  const sidebar = await renderSidebar(t, recordField("logo", "Image"));
  assert.match(sidebar.text(), /acme\.png/);
  await sidebar.click("Select existing image");
  await sidebar.click("Pick logo.png");
  await sidebar.unlinkAsset();
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.content]),
    [
      ["collectionDefinitions/editRecord", { ...acmeContent, logo: pickedLogo }],
      ["collectionDefinitions/editRecord", { ...acmeContent, logo: null }],
    ],
  );
  assert.deepEqual(sidebar.selection(), recordField("logo", "Image"));
});

void test("record image list edits are saved to the record as asset snapshots", async (t) => {
  const sidebar = await renderSidebar(t, recordField("gallery", "ImageList"));
  assert.match(sidebar.text(), /team\.png/);
  await sidebar.click("Select existing images");
  await sidebar.click("Pick logo.png");
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.content]),
    [
      [
        "collectionDefinitions/editRecord",
        { ...acmeContent, gallery: [...acmeContent.gallery, pickedLogo] },
      ],
    ],
  );
});

void test("record asset edits are not sent while viewing the live site", async (t) => {
  const sidebar = await renderSidebar(t, recordField("logo", "Image"));
  await act(async () => sidebar.previewStore.send({ type: "viewLiveSite" }));
  await sidebar.unlinkAsset();
  assert.deepEqual(sidebar.writes, []);
});

void test("unlinking a block asset used nowhere else offers to delete the file", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { type: "block-field", blockId: BLOCK_ID, fieldName: "logo", fieldType: "Image" },
    { fileUsage: 1 },
  );
  await sidebar.unlinkAsset();
  assert.ok(sidebar.hasButton("Delete file"), "the unlink dialog offers to delete the file");
  assert.deepEqual(sidebar.writes, []);
});

// File usage counts ignore records, so a record's file would always look unused.
void test("unlinking a record image never offers to delete the file", async (t) => {
  const sidebar = await renderSidebar(t, recordField("logo", "Image"), { fileUsage: 0 });
  await sidebar.unlinkAsset();
  assert.ok(!sidebar.hasButton("Delete file"));
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.content]),
    [["collectionDefinitions/editRecord", { ...acmeContent, logo: null }]],
  );
});

void test("unlinking a record image list entry never offers to delete the file", async (t) => {
  const sidebar = await renderSidebar(t, recordField("gallery", "ImageList"), { fileUsage: 0 });
  await sidebar.unlinkAsset();
  assert.ok(!sidebar.hasButton("Delete file"));
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.content]),
    [["collectionDefinitions/editRecord", { ...acmeContent, gallery: [] }]],
  );
});

void test("the block field list summarizes a reference list by its count", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { type: "block", blockId: BLOCK_ID },
    { logos: [ACME, GLOBEX] },
  );
  assert.match(sidebar.text(), /Logos\s*2 linked/);
});

void test("an empty reference list says which collection it expects in the field list", async (t) => {
  const sidebar = await renderSidebar(t, { type: "block", blockId: BLOCK_ID }, { company: ACME });
  assert.match(sidebar.text(), /Logos\s*No Customers linked/);
  assert.doesNotMatch(sidebar.text(), /Logos\s*No Customers linked\s*Required/);
});

const logosField = {
  type: "block-field",
  blockId: BLOCK_ID,
  fieldName: "logos",
  fieldType: "ReferenceList",
} as const;

const cards = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-record-card]")].map((card) => ({
    label: card.querySelector("button[aria-label^='Open']")?.getAttribute("aria-label"),
    text: card.textContent ?? "",
    dragHandle: card.querySelector("button[aria-label='Reorder']") != null,
    hint: card.closest("li")?.querySelector("[data-reference-hint]")?.textContent ?? null,
  }));

void test("a reference list shows its records as cards in list order", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX, ACME] });
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Logos"]);
  const shown = cards(sidebar.host);
  assert.deepEqual(
    shown.map((card) => card.label),
    ["Open Globex", "Open Acme"],
  );
  assert.match(shown[0]!.text, /Globex\s*Draft\s*Customers/);
  assert.match(shown[1]!.text, /Acme\s*Published\s*Customers/);
  assert.ok(
    shown.every((card) => card.dragHandle),
    "every card has a drag handle",
  );
  assert.ok(
    !sidebar.host.querySelector("[data-record-card] img"),
    "cards never show the record's image",
  );
  assert.deepEqual(
    shown.map((card) => card.hint),
    [null, null],
    "never-published records are not flagged",
  );
  assert.doesNotMatch(sidebar.text(), /Required|Blocks publishing/);
});

void test("unlinking a listed record writes the list without it and never offers deletion", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX, ACME, INITECH] });
  const unlink = sidebar.host
    .querySelectorAll<HTMLElement>("[data-record-card]")[1]
    ?.querySelector<HTMLElement>("button[aria-label='Unlink']");
  assert.ok(unlink, "each card has an unlink button");
  await act(async () => unlink.click());
  await sidebar.settle();
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "blocks/updateContent",
      input: { id: BLOCK_ID, content: { logos: [GLOBEX, INITECH] } },
    },
  ]);
  assert.equal(sidebar.modalOpened(), false);
  assert.ok(!sidebar.hasButton("Delete"), "no deletion is offered");
  assert.deepEqual(
    cards(sidebar.host).map((card) => card.label),
    ["Open Globex", "Open Initech"],
  );
});

void test("clicking a listed record card opens its record view, whose field edits save to the record", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX, ACME] });
  await sidebar.click("Open Acme");
  assert.deepEqual(sidebar.selection(), {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "logos",
    recordId: ACME,
  });
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Logos", "Acme"]);
  assert.ok(sidebar.host.querySelector("[data-shared-record]"));
  await act(async () =>
    sidebar.previewStore.send({
      type: "selectRecordField",
      ...owner,
      blockId: BLOCK_ID,
      fieldName: "logos",
      recordId: ACME,
      recordFieldName: "quote",
      recordFieldType: "String",
    }),
  );
  await sidebar.settle();
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Logos", "Acme", "Quote"]);
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
  await sidebar.click("Logos");
  assert.deepEqual(sidebar.selection(), logosField);
});

void test("a selection on a record no longer in the list falls back to the reference list view", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { type: "record", blockId: BLOCK_ID, fieldName: "logos", recordId: ACME },
    { logos: [GLOBEX, ACME] },
  );
  assert.ok(sidebar.host.querySelector("[data-shared-record]"));
  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      block: {
        ...bundle.block,
        content: { ...bundle.block.content, logos: [GLOBEX] },
        references: { ...bundle.block.references, logos: [bundle.block.references.logos[0]] },
      },
    }));
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), logosField);
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Logos"]);
  assert.deepEqual(
    cards(sidebar.host).map((card) => card.label),
    ["Open Globex"],
  );
});

void test("a selected record still in the list but not yet loaded keeps its selection", async (t) => {
  const selection = {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "logos",
    recordId: INITECH,
  } as const;
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX] });
  // The list links the record before the block's hydrated records include it.
  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      block: { ...bundle.block, content: { ...bundle.block.content, logos: [GLOBEX, INITECH] } },
    }));
    sidebar.previewStore.send({ type: "selectTarget", ...owner, selection });
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), selection, "the selection is not bounced to the list");

  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      block: {
        ...bundle.block,
        references: { ...bundle.block.references, logos: listedRecords.slice(1) },
      },
    }));
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), selection);
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Logos", "Initech"]);
});

void test("reordering a list keeps the selected record", async (t) => {
  const selection = {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "logos",
    recordId: ACME,
  } as const;
  const sidebar = await renderSidebar(t, selection, { logos: [GLOBEX, ACME] });
  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      block: {
        ...bundle.block,
        content: { ...bundle.block.content, logos: [ACME, GLOBEX] },
        references: {
          ...bundle.block.references,
          logos: [...bundle.block.references.logos].reverse(),
        },
      },
    }));
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), selection);
  assert.ok(sidebar.host.querySelector("[data-shared-record]"));
});

void test("hovering a listed record card or its record field rows highlights that entry in the preview", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX, ACME] });
  const messages: unknown[] = [];
  const iframe = {
    contentWindow: { postMessage: (message: unknown) => messages.push(message) },
  } as unknown as HTMLIFrameElement;
  await act(async () => sidebar.previewStore.send({ type: "setIframeElement", element: iframe }));
  t.after(() => sidebar.previewStore.send({ type: "setIframeElement", element: null }));
  const hover = async (element: Element, type: "mouseover" | "mouseout") => {
    await act(async () => {
      element.dispatchEvent(new window.MouseEvent(type, { bubbles: true }) as unknown as Event);
    });
  };

  const card = sidebar.host.querySelectorAll("[data-record-card]")[1]!;
  await hover(card, "mouseover");
  assert.deepEqual(messages.at(-1), {
    type: "CAMOX_HOVER_FIELD",
    fieldId: `${BLOCK_ID}__logos__acme`,
  });
  await hover(card, "mouseout");
  assert.deepEqual(messages.at(-1), {
    type: "CAMOX_HOVER_FIELD_END",
    fieldId: `${BLOCK_ID}__logos__acme`,
  });

  await sidebar.click("Open Acme");
  const quote = [...sidebar.host.querySelectorAll("label")]
    .find((label) => label.textContent === "Quote")
    ?.closest(".space-y-2");
  assert.ok(quote, "the record view lists its field rows");
  await hover(quote, "mouseover");
  assert.deepEqual(messages.at(-1), {
    type: "CAMOX_HOVER_FIELD",
    fieldId: `${BLOCK_ID}__logos__acme__quote`,
  });
});

void test("the picker offers only unlinked records and appends the chosen one", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX] });
  await sidebar.openPicker();
  assert.deepEqual(sidebar.options(), ["AcmePublished", "InitechModified"]);
  await sidebar.pick("Initech");
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "blocks/updateContent",
      input: { id: BLOCK_ID, content: { logos: [GLOBEX, INITECH] } },
    },
  ]);
  assert.deepEqual(sidebar.selection(), logosField, "the view stays on the list");
  assert.deepEqual(sidebar.previewLogos(), ["Globex: Globex", "Initech: Initech"]);
});

void test("the first record picked into an empty list shows in the preview", async (t) => {
  const sidebar = await renderSidebar(t, logosField);
  await sidebar.openPicker();
  await sidebar.pick("Acme");
  assert.deepEqual(sidebar.writes, [
    { procedure: "blocks/updateContent", input: { id: BLOCK_ID, content: { logos: [ACME] } } },
  ]);
  assert.deepEqual(sidebar.previewLogos(), ["Acme: Acme"]);
});

void test("the picker explains when every record is already linked", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [ACME, GLOBEX] });
  await act(async () => {
    sidebar.client.setQueryData(
      collectionQueries.records("site", "customers").queryKey,
      (records: any) => records.slice(0, 2),
    );
  });
  await sidebar.openPicker();
  assert.deepEqual(sidebar.options(), []);
  assert.match(document.body.textContent ?? "", /Every Customers item is already linked/);
});

void test("the picker is replaced by a limit message once the list reaches its maximum", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [ACME, GLOBEX, INITECH] });
  assert.equal(cards(sidebar.host).length, 3);
  assert.ok(!sidebar.host.querySelector("button[aria-haspopup]"), "no picker at maxItems");
  assert.match(sidebar.text(), /Limit of 3 reached/);
});

void test("Create item prefills the label, appends the saved record, and cancel changes nothing", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [ACME] });
  const createFromSearch = async () => {
    await sidebar.openPicker();
    await sidebar.search("Hooli");
    await sidebar.click("Create item");
  };
  await createFromSearch();
  const name = document.querySelector<HTMLTextAreaElement>("#collection-name");
  assert.equal(name?.value, "Hooli", "the label is prefilled from the search");
  await sidebar.click("Close");
  assert.equal(sidebar.modalOpened(), false);
  assert.equal(sidebar.writes.length, 0, "cancel leaves the list unchanged");

  await createFromSearch();
  await sidebar.submitCreateForm();
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input]),
    [
      [
        "collectionDefinitions/createRecord",
        {
          projectSlug: "site",
          collectionId: "customers",
          content: {
            name: "Hooli",
            quote: "",
            contact: null,
            featured: false,
            logo: null,
            gallery: [],
          },
        },
      ],
      ["blocks/updateContent", { id: BLOCK_ID, content: { logos: [ACME, CREATED] } }],
    ],
  );
  assert.equal(sidebar.modalOpened(), false);
  assert.deepEqual(sidebar.selection(), logosField, "the view stays on the list");
  assert.deepEqual(sidebar.previewLogos(), ["Acme: Acme", "Hooli: Hooli"]);
});

/** Lays the list's cards out vertically, which happy-dom doesn't do, so drags can measure them. */
function stackCards(t: TestContext, host: HTMLElement) {
  const items = () =>
    [...host.querySelectorAll("[data-record-card]")].map((card) => card.closest("li"));
  t.mock.method(
    window.HTMLElement.prototype,
    "getBoundingClientRect",
    function (this: HTMLElement) {
      const index = items().indexOf(this as HTMLLIElement);
      const top = index === -1 ? 0 : index * 60;
      return { x: 0, y: top, top, left: 0, width: 200, height: 50, right: 200, bottom: top + 50 };
    },
  );
}

void test("dragging a card writes the new order", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX, ACME, INITECH] });
  stackCards(t, sidebar.host);
  const handle = sidebar.host.querySelector<HTMLElement>("button[aria-label='Reorder']");
  assert.ok(handle);
  const press = async (code: string) => {
    await act(async () => {
      handle.dispatchEvent(
        new window.KeyboardEvent("keydown", { code, bubbles: true }) as unknown as KeyboardEvent,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await act(async () => handle.focus());
  await press("Space");
  await press("ArrowDown");
  await press("Space");
  await sidebar.settle();
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "blocks/updateContent",
      input: { id: BLOCK_ID, content: { logos: [ACME, GLOBEX, INITECH] } },
    },
  ]);
  assert.deepEqual(
    cards(sidebar.host).map((card) => card.label),
    ["Open Acme", "Open Globex", "Open Initech"],
  );
});

void test("reference list changes are not sent while viewing the live site", async (t) => {
  const sidebar = await renderSidebar(t, logosField, { logos: [GLOBEX, ACME] });
  await act(async () => sidebar.previewStore.send({ type: "viewLiveSite" }));
  const unlink = sidebar.host.querySelector<HTMLElement>("button[aria-label='Unlink']");
  assert.ok(unlink);
  await act(async () => unlink.click());
  await sidebar.settle();
  assert.deepEqual(sidebar.writes, []);
  assert.deepEqual(
    cards(sidebar.host).map((card) => card.label),
    ["Open Globex", "Open Acme"],
    "the list is unchanged",
  );
});

void test("the preview's empty-list placeholder opens the list view with the picker focused", async (t) => {
  referencePickerFocus.send({ type: "request", fieldId: `${BLOCK_ID}__logos` });
  const sidebar = await renderSidebar(t, logosField);
  await sidebar.settle();
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search items"]');
  assert.ok(input, "the picker opens");
  assert.equal(document.activeElement, input, "the search input has focus");
  assert.equal(referencePickerFocus.getSnapshot().context.fieldId, null, "the request is consumed");
});

const sponsorField = {
  type: "item-field",
  blockId: BLOCK_ID,
  itemId: ITEM_ID,
  fieldName: "sponsor",
  fieldType: "Reference",
} as const;

void test("an item's reference opens its record view under the item, and steps back to it", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { type: "item", blockId: BLOCK_ID, itemId: ITEM_ID },
    {
      sponsor: ACME,
    },
  );
  assert.match(sidebar.text(), /Sponsor\s*Acme/);
  // The field row's drill button shows the linked record's label.
  await sidebar.click("Acme");
  assert.deepEqual(sidebar.selection(), sponsorField);
  await sidebar.click("Open Acme");
  assert.deepEqual(sidebar.selection(), {
    type: "record",
    blockId: BLOCK_ID,
    itemId: ITEM_ID,
    fieldName: "sponsor",
    recordId: ACME,
  });
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "People", "Ada", "Sponsor", "Acme"]);
  assert.match(sidebar.text(), /Quote\s*Great/);
  assert.ok(!sidebar.hasButton("Add sibling"), "item list actions belong to the item view");

  await sidebar.click("Sponsor");
  assert.deepEqual(sidebar.selection(), sponsorField);
  await sidebar.click("Ada");
  assert.deepEqual(sidebar.selection(), { type: "item", blockId: BLOCK_ID, itemId: ITEM_ID });
});

void test("record field edits reached through an item save to the record", async (t) => {
  const sidebar = await renderSidebar(
    t,
    {
      type: "record-field",
      blockId: BLOCK_ID,
      itemId: ITEM_ID,
      fieldName: "sponsor",
      recordId: ACME,
      recordFieldName: "quote",
      recordFieldType: "String",
    },
    { sponsor: ACME },
  );
  await sidebar.typeText("Superb");
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.id, write.input.content]),
    [["collectionDefinitions/editRecord", ACME, { ...acmeContent, quote: "Superb" }]],
  );
});

void test("an item's record selection falls back to the item's reference field once unlinked", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { type: "record", blockId: BLOCK_ID, itemId: ITEM_ID, fieldName: "sponsor", recordId: ACME },
    { sponsor: ACME },
  );
  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      repeatableItems: bundle.repeatableItems.map((item: any) => ({
        ...item,
        content: { ...item.content, sponsor: null },
        references: { ...item.references, sponsor: null },
      })),
    }));
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), sponsorField);
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "People", "Ada", "Sponsor"]);
  assert.ok(sidebar.host.querySelector("button[aria-haspopup]"), "the picker is shown again");
});

void test("an item's reference list writes to the item and updates its preview records first", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { ...sponsorField, fieldName: "partners", fieldType: "ReferenceList" },
    { partners: [GLOBEX, ACME] },
  );
  assert.deepEqual(
    cards(sidebar.host).map((card) => card.label),
    ["Open Globex", "Open Acme"],
  );
  const unlink = sidebar.host
    .querySelectorAll<HTMLElement>("[data-record-card]")[0]
    ?.querySelector<HTMLElement>("button[aria-label='Unlink']");
  await act(async () => unlink!.click());
  await sidebar.settle();
  assert.deepEqual(sidebar.writes, [
    {
      procedure: "repeatableItems/updateContent",
      input: { id: ITEM_ID, content: { partners: [ACME] } },
    },
  ]);
  assert.deepEqual(sidebar.previewPartners(), ["Acme"]);

  await sidebar.click("Open Acme");
  assert.deepEqual(sidebar.selection(), {
    type: "record",
    blockId: BLOCK_ID,
    itemId: ITEM_ID,
    fieldName: "partners",
    recordId: ACME,
  });
  assert.ok(sidebar.host.querySelector("[data-shared-record]"), "listed records are shared");
});

const contactRecord = {
  type: "record",
  blockId: BLOCK_ID,
  fieldName: "company",
  recordId: ACME,
  nested: { fieldName: "contact", recordId: ADA },
} as const;

void test("a placed record's reference opens the record it links, one hop further", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
  });
  assert.match(sidebar.text(), /Contact\s*Ada Lovelace/);
  // The field row's drill button shows the linked record's label.
  await sidebar.click("Ada Lovelace");
  assert.deepEqual(sidebar.selection(), {
    type: "record-field",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
    recordFieldName: "contact",
    recordFieldType: "Reference",
  });
  await sidebar.click("Open Ada Lovelace");
  assert.deepEqual(sidebar.selection(), contactRecord);
  assert.deepEqual(sidebar.crumbs(), [
    "Page",
    "Testimonial",
    "Company",
    "Acme",
    "Contact",
    "Ada Lovelace",
  ]);
  assert.match(sidebar.text(), /Role\s*CTO/);

  await sidebar.click("Acme");
  assert.deepEqual(sidebar.selection(), {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
  });
});

void test("field edits of a record linked by a placed record save to that record", async (t) => {
  const sidebar = await renderSidebar(t, {
    ...contactRecord,
    type: "record-field",
    recordFieldName: "role",
    recordFieldType: "String",
  });
  await sidebar.typeText("CEO");
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.id, write.input.content]),
    [["collectionDefinitions/editRecord", ADA, { name: "Ada Lovelace", role: "CEO" }]],
  );
});

void test("linking a record from a placed record writes the placed record", async (t) => {
  const sidebar = await renderSidebar(t, {
    type: "record-field",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
    recordFieldName: "contact",
    recordFieldType: "Reference",
  });
  const unlink = sidebar.host.querySelector<HTMLElement>("button[aria-label='Unlink']");
  await act(async () => unlink!.click());
  await sidebar.settle();
  assert.deepEqual(
    sidebar.writes.map((write) => [write.procedure, write.input.id, write.input.content]),
    [["collectionDefinitions/editRecord", ACME, { ...acmeContent, contact: null }]],
  );
});

void test("a linked record's selection falls back to the placed record's field once unlinked", async (t) => {
  const sidebar = await renderSidebar(t, contactRecord);
  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      block: {
        ...bundle.block,
        references: {
          ...bundle.block.references,
          company: { ...acme, content: { ...acmeContent, contact: null }, references: {} },
        },
      },
    }));
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), {
    type: "record-field",
    blockId: BLOCK_ID,
    fieldName: "company",
    recordId: ACME,
    recordFieldName: "contact",
    recordFieldType: "Reference",
  });
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Company", "Acme", "Contact"]);
});

void test("the block field list summarizes a query-backed reference list by its result count", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { type: "block", blockId: BLOCK_ID },
    { recent: [ACME, GLOBEX] },
  );
  assert.match(sidebar.text(), /Recent\s*2 results/);
});

const recentField = {
  type: "block-field",
  blockId: BLOCK_ID,
  fieldName: "recent",
  fieldType: "ReferenceList",
} as const;

void test("a query-backed list shows its results as read-only cards under a summary of its query", async (t) => {
  const sidebar = await renderSidebar(t, recentField, { recent: [ACME, GLOBEX, INITECH] });
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Recent"]);
  assert.match(sidebar.text(), /First 3 by Name, A to Z/);
  const shown = cards(sidebar.host);
  assert.deepEqual(
    shown.map((card) => card.label),
    ["Open Acme", "Open Globex", "Open Initech"],
    "cards follow the query's result order",
  );
  assert.match(shown[1]!.text, /Globex\s*Draft\s*Customers/);
  assert.ok(
    shown.every((card) => !card.dragHandle),
    "results cannot be reordered",
  );
  assert.ok(!sidebar.hasButton("Unlink"), "results cannot be unlinked");
  assert.ok(!sidebar.host.querySelector("button[aria-haspopup]"), "no record picker");
  assert.ok(!sidebar.hasButton("Create item"));
  assert.doesNotMatch(sidebar.text(), /Limit of/);
  assert.deepEqual(sidebar.writes, []);
});

void test("an empty query result offers nothing to add", async (t) => {
  const fieldList = await renderSidebar(t, { type: "block", blockId: BLOCK_ID });
  assert.match(fieldList.text(), /Recent\s*0 results/);
  const sidebar = await renderSidebar(t, recentField);
  assert.match(sidebar.text(), /First 3 by Name, A to Z/);
  assert.equal(cards(sidebar.host).length, 0);
  assert.ok(!sidebar.host.querySelector("button[aria-haspopup]"), "no record picker");
  assert.ok(!sidebar.hasButton("Create item"));
});

void test("clicking a query result card opens its record view, whose field edits save to the record", async (t) => {
  const sidebar = await renderSidebar(t, recentField, { recent: [ACME, GLOBEX] });
  await sidebar.click("Open Acme");
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), {
    type: "record",
    blockId: BLOCK_ID,
    fieldName: "recent",
    recordId: ACME,
  });
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Recent", "Acme"]);
  assert.ok(sidebar.host.querySelector("[data-shared-record]"));
  await act(async () =>
    sidebar.previewStore.send({
      type: "selectRecordField",
      ...owner,
      blockId: BLOCK_ID,
      fieldName: "recent",
      recordId: ACME,
      recordFieldName: "quote",
      recordFieldType: "String",
    }),
  );
  await sidebar.settle();
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
});

void test("a selection on a record that left the query's results falls back to the list view", async (t) => {
  const sidebar = await renderSidebar(
    t,
    { type: "record", blockId: BLOCK_ID, fieldName: "recent", recordId: ACME },
    { recent: [ACME, GLOBEX] },
  );
  assert.ok(sidebar.host.querySelector("[data-shared-record]"));
  await act(async () => {
    sidebar.client.setQueryData(blockQueries.get(BLOCK_ID).queryKey, (bundle: any) => ({
      ...bundle,
      block: {
        ...bundle.block,
        references: { ...bundle.block.references, recent: [bundle.block.references.recent[1]] },
      },
    }));
  });
  await sidebar.settle();
  assert.deepEqual(sidebar.selection(), recentField);
  assert.deepEqual(sidebar.crumbs(), ["Page", "Testimonial", "Recent"]);
  assert.deepEqual(
    cards(sidebar.host).map((card) => card.label),
    ["Open Globex"],
  );
});
