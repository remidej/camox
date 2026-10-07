import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { previewStore, type Selection } from "../../features/preview/previewStore";
import { CamoxAppProvider } from "../../features/provider/components/CamoxAppContext";
import { initApiClient } from "../../lib/api-client";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import type { CamoxApp } from "../createApp";
import { createCollection } from "../createCollection";
import { Type } from "../lib/contentType";
import type { ReferenceRecord } from "../lib/reference";

// Exercise the actual editable scope, field and normalized provider. The harness
// substitutes only network/auth/iframe boundaries and Lexical's input surface
// (Lexical itself has dedicated DOM editing tests).
const editors: Array<{ onChange: (value: string) => void; externalState: unknown }> = [];
const selections: unknown[] = [];
const owner = { kind: "page", pageId: 1 } as const;
const requests: Array<{ expectedVersion: number; content: Record<string, unknown> }> = [];
let source: ReferenceRecord;
Object.assign(globalThis, {
  React,
  __CAMOX_TELEMETRY_DISABLED__: true,
  captureReferenceEditor: (props: (typeof editors)[number]) => editors.push(props),
  captureReferenceSelection: (selection: Selection) => {
    selections.push(selection);
    previewStore.send({ type: "selectTarget", ...owner, selection });
  },
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
      "../../features/preview/components/Frame":
        "export const useFrame = () => ({window: globalThis.window ?? null})",
      "../hooks/useIsEditable.ts": "export const useIsEditable = mode => mode === 'site'",
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
const { PreviewEditingOwnerContext } = await import("../../features/preview/previewSelection");
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
    type: "record-field",
    blockId: 1,
    fieldName: "customer",
    recordId: "source-id",
    recordFieldName: "name",
    recordFieldType: "String",
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
    // The field title is not the collection's: the placeholder names the collection.
    content: { customer: Type.Reference(customers, { title: "Company" }) },
    toMarkdown: () => [],
    component: () => (
      <block.Reference name="customer">{(customer) => <h2>{customer.label}</h2>}</block.Reference>
    ),
  });
  const app = { getCollectionById: (id: string) => (id === "customers" ? customers : undefined) };
  const placement = (mode: "site" | "peek") => (
    <CamoxAppProvider app={app as unknown as CamoxApp}>
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
    </CamoxAppProvider>
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

void test("clicks inside a placed record select its record field or the record for that placement only", async () => {
  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "",
    label: "name",
    content: { name: Type.String({ default: "" }) },
  });
  const record: ReferenceRecord = {
    id: "acme",
    collectionId: "customers",
    label: "Acme",
    content: { name: "Acme Inc." },
    version: 1,
  };
  const block = createEditableBlock({
    id: "placements",
    title: "",
    description: "",
    content: { name: Type.String({ default: "" }), customer: Type.Reference(customers) },
    toMarkdown: () => [],
    component: () => (
      <block.Reference name="customer">
        {(customer) => (
          <section>
            <customer.Field name="name">{(props) => <h2 {...props} />}</customer.Field>
            <p>Since 1999</p>
          </section>
        )}
      </block.Reference>
    ),
  });

  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "activatePage", pageId: owner.pageId });
  const placement = (blockId: number) =>
    host.querySelector<HTMLElement>(`[data-camox-field-id="${blockId}__customer"]`)!;
  const recordField = (blockId: number) =>
    host.querySelector<HTMLElement>(`[data-camox-field-id="${blockId}__customer__name"]`)!;
  const focused = (element: Element) => element.hasAttribute("data-camox-focused");
  const hovered = (element: Element) => element.hasAttribute("data-camox-hovered");
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <PreviewEditingOwnerContext value={owner}>
            <NormalizedDataProvider
              files={[]}
              repeatableItems={[]}
              blocks={[{ references: { customer: record } }]}
            >
              {[1, 2].map((blockId) => (
                <block._internal.Component
                  key={blockId}
                  mode="site"
                  blockData={{
                    _id: blockId,
                    type: "placements",
                    position: `a${blockId}`,
                    content: { name: "Block name", customer: "acme" },
                  }}
                />
              ))}
            </NormalizedDataProvider>
          </PreviewEditingOwnerContext>
        </QueryClientProvider>,
      ),
    );

    await act(async () => recordField(2).click());
    assert.deepEqual(selections.at(-1), {
      type: "record-field",
      blockId: 2,
      fieldName: "customer",
      recordId: "acme",
      recordFieldName: "name",
      recordFieldType: "String",
    });
    assert.ok(focused(recordField(2)), "the clicked placement's record field is selected");
    assert.ok(!focused(recordField(1)), "another placement of the same record is not");

    await act(async () => host.querySelectorAll("p")[0].click());
    assert.deepEqual(selections.at(-1), {
      type: "record",
      blockId: 1,
      fieldName: "customer",
      recordId: "acme",
    });
    assert.ok(focused(placement(1)), "the clicked placement's record is selected");
    assert.ok(!focused(placement(2)));
    assert.ok(!focused(recordField(1)) && !focused(recordField(2)));

    // A block field sharing the record field's name must not light up the record field.
    await act(async () =>
      previewStore.send({
        type: "selectTarget",
        ...owner,
        selection: { type: "block-field", blockId: 1, fieldName: "name", fieldType: "String" },
      }),
    );
    assert.ok(!focused(recordField(1)));

    // Sidebar hover of a record field row targets the selected placement's field ID.
    await act(async () => {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: { type: "CAMOX_HOVER_FIELD", fieldId: "2__customer__name" },
        }),
      );
    });
    assert.ok(hovered(recordField(2)));
    assert.ok(!hovered(recordField(1)));
  } finally {
    await act(async () => root.unmount());
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "exitEditMode" });
    await window.happyDOM.close();
  }
});

void test("record images and files select their record field for that placement only", async () => {
  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "",
    label: "name",
    content: {
      name: Type.String({ default: "" }),
      logo: Type.Image({ title: "Logo" }),
      gallery: Type.ImageList({ title: "Gallery" }),
      brochure: Type.File({ accept: ["application/pdf"], title: "Brochure" }),
      attachments: Type.FileList({ accept: ["application/pdf"], title: "Attachments" }),
    },
  });
  const asset = (name: string, mimeType: string, fileId: string) => ({
    url: `https://cdn.test/${name}`,
    alt: "",
    filename: name,
    mimeType,
    _fileId: fileId,
  });
  const record: ReferenceRecord = {
    id: "acme",
    collectionId: "customers",
    label: "Acme",
    content: {
      name: "Acme Inc.",
      logo: asset("logo.png", "image/png", "1"),
      gallery: [asset("team.png", "image/png", "2")],
      brochure: asset("brochure.pdf", "application/pdf", "3"),
      attachments: [asset("terms.pdf", "application/pdf", "4")],
    },
    version: 1,
  };
  const block = createEditableBlock({
    id: "record-assets",
    title: "",
    description: "",
    content: { logo: Type.Image({ title: "Logo" }), customer: Type.Reference(customers) },
    toMarkdown: () => [],
    component: () => (
      <block.Reference name="customer">
        {(customer) => (
          <section>
            <customer.Image name="logo">{(props) => <img {...props} />}</customer.Image>
            <customer.ImageList name="gallery">{(props) => <img {...props} />}</customer.ImageList>
            <customer.File name="brochure">
              {(props, file) => <a {...props}>{file.filename}</a>}
            </customer.File>
            <customer.FileList name="attachments">
              {(props, file) => <a {...props}>{file.filename}</a>}
            </customer.FileList>
          </section>
        )}
      </block.Reference>
    ),
  });

  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const writesBefore = requests.length;
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "activatePage", pageId: owner.pageId });
  const field = (blockId: number, name: string) =>
    host.querySelector<HTMLElement>(`[data-camox-field-id="${blockId}__customer__${name}"]`);
  const focused = (element: Element | null) => !!element?.hasAttribute("data-camox-focused");
  const inField = (blockId: number, name: string, selector: string) =>
    field(blockId, name)?.querySelector<HTMLElement>(selector);
  const recordField = (blockId: number, recordFieldName: string, recordFieldType: string) => ({
    type: "record-field",
    blockId,
    fieldName: "customer",
    recordId: "acme",
    recordFieldName,
    recordFieldType,
  });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <PreviewEditingOwnerContext value={owner}>
            <NormalizedDataProvider
              files={[]}
              repeatableItems={[]}
              blocks={[{ references: { customer: record } }]}
            >
              {[1, 2].map((blockId) => (
                <block._internal.Component
                  key={blockId}
                  mode="site"
                  blockData={{
                    _id: blockId,
                    type: "record-assets",
                    position: `a${blockId}`,
                    content: {
                      logo: asset("block.png", "image/png", "5") as never,
                      customer: "acme",
                    },
                  }}
                />
              ))}
            </NormalizedDataProvider>
          </PreviewEditingOwnerContext>
        </QueryClientProvider>,
      ),
    );

    const logo = inField(2, "logo", "img");
    assert.ok(logo, "the record image renders inside its own field");
    assert.match(logo.getAttribute("src") ?? "", /logo\.png/);
    await act(async () => logo.click());
    assert.deepEqual(selections.at(-1), recordField(2, "logo", "Image"));
    assert.ok(focused(field(2, "logo")), "the clicked placement's record image is selected");
    assert.ok(!focused(field(1, "logo")), "another placement of the same record is not");
    assert.ok(!focused(host.querySelector('[data-camox-field-id="2__logo"]')));

    await act(async () => inField(1, "gallery", "img")!.click());
    assert.deepEqual(selections.at(-1), recordField(1, "gallery", "ImageList"));
    assert.ok(focused(field(1, "gallery")));
    assert.ok(!focused(field(2, "gallery")));

    const brochure = field(1, "brochure");
    assert.equal(brochure?.tagName, "A", "the site's file link itself is the field, unwrapped");
    assert.equal(brochure.parentElement?.tagName, "SECTION");
    const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => brochure.dispatchEvent(click as unknown as Event));
    assert.ok(click.defaultPrevented, "selecting a file does not download it");
    assert.deepEqual(selections.at(-1), recordField(1, "brochure", "File"));

    assert.ok(focused(brochure));
    assert.ok(!focused(field(2, "brochure")));

    await act(async () => field(2, "attachments")!.click());
    assert.deepEqual(selections.at(-1), recordField(2, "attachments", "FileList"));
    assert.equal(requests.length, writesBefore, "selecting record assets never writes");
  } finally {
    await act(async () => root.unmount());
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "exitEditMode" });
    await window.happyDOM.close();
  }
});

void test("record embeds select their record field for that placement only", async () => {
  const embed = { pattern: "^https://video\\.test/", default: "https://video.test/intro" };
  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "",
    label: "name",
    content: { name: Type.String({ default: "" }), video: Type.Embed(embed) },
  });
  const record: ReferenceRecord = {
    id: "acme",
    collectionId: "customers",
    label: "Acme",
    content: { name: "Acme Inc.", video: "https://video.test/acme" },
    version: 1,
  };
  const block = createEditableBlock({
    id: "record-embed",
    title: "",
    description: "",
    content: { video: Type.Embed(embed), customer: Type.Reference(customers) },
    toMarkdown: () => [],
    component: () => (
      <block.Reference name="customer">
        {(customer) => (
          <section>
            <customer.Embed name="video">{(props) => <span>{props.src}</span>}</customer.Embed>
          </section>
        )}
      </block.Reference>
    ),
  });

  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "activatePage", pageId: owner.pageId });
  const video = (blockId: number) =>
    host.querySelector<HTMLElement>(`[data-camox-field-id="${blockId}__customer__video"]`);
  const focused = (element: Element | null) => !!element?.hasAttribute("data-camox-focused");
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <PreviewEditingOwnerContext value={owner}>
            <NormalizedDataProvider
              files={[]}
              repeatableItems={[]}
              blocks={[{ references: { customer: record } }]}
            >
              {[1, 2].map((blockId) => (
                <block._internal.Component
                  key={blockId}
                  mode="site"
                  blockData={{
                    _id: blockId,
                    type: "record-embed",
                    position: `a${blockId}`,
                    content: { video: "https://video.test/block" as never, customer: "acme" },
                  }}
                />
              ))}
            </NormalizedDataProvider>
          </PreviewEditingOwnerContext>
        </QueryClientProvider>,
      ),
    );

    const player = video(2)?.querySelector("span");
    assert.equal(player?.textContent, "https://video.test/acme");
    await act(async () => player!.click());
    assert.deepEqual(selections.at(-1), {
      type: "record-field",
      blockId: 2,
      fieldName: "customer",
      recordId: "acme",
      recordFieldName: "video",
      recordFieldType: "Embed",
    });
    assert.ok(focused(video(2)), "the clicked placement's record embed is selected");
    assert.ok(!focused(video(1)), "another placement of the same record is not");
  } finally {
    await act(async () => root.unmount());
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "exitEditMode" });
    await window.happyDOM.close();
  }
});

void test("editable reference lists render their linked records in stored order and nothing when empty", () => {
  const customers = createCollection({
    id: "customers",
    title: "Customers",
    description: "",
    label: "name",
    content: { name: Type.String({ default: "" }) },
  });
  const records: ReferenceRecord[] = ["Acme", "Beta"].map((name) => ({
    id: `${name.toLowerCase()}-id`,
    collectionId: "customers",
    label: `${name} label`,
    content: { name },
    version: 1,
  }));
  const block = createEditableBlock({
    id: "logo-grid",
    title: "",
    description: "",
    content: { customers: Type.ReferenceList(customers) },
    toMarkdown: () => [],
    component: () => (
      <ul>
        <block.ReferenceList name="customers">
          {(customer) => (
            <li aria-label={customer.label}>
              <customer.Field name="name">{(props) => <b {...props} />}</customer.Field>
            </li>
          )}
        </block.ReferenceList>
      </ul>
    ),
  });
  const render = (customerIds: string[]) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <NormalizedDataProvider
          files={[]}
          repeatableItems={[]}
          blocks={[{ references: { customers: records } }]}
        >
          <block._internal.Component
            mode="site"
            blockData={{
              _id: 4,
              type: "logo-grid",
              position: "a0",
              content: { customers: customerIds },
            }}
          />
        </NormalizedDataProvider>
      </QueryClientProvider>,
    );
  const writesBefore = requests.length;
  const html = render(["beta-id", "missing-id", "acme-id"]);
  assert.deepEqual(
    [...html.matchAll(/<li aria-label="([^"]+)">/g)].map((match) => match[1]),
    ["Beta label", "Acme label"],
  );
  assert.match(html, /Beta.*Acme/s);
  assert.doesNotMatch(render([]), /<li/);
  assert.equal(requests.length, writesBefore);
});
