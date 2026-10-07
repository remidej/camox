import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NavigationProvider } from "../features/navigation/navigation";
import { initApiClient } from "../lib/api-client";
import { AuthContext } from "../lib/auth";
import { NormalizedDataProvider, type NormalizedFile } from "../lib/normalized-data";
import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";
import { ReferenceWrites } from "./editing/referenceWrites";
import { contentFieldBuilder } from "./lib/contentType";
import { referenceOccurrenceId, resolveReference, type ReferenceRecord } from "./lib/reference";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("https://api.example.test");
const customers = createCollection({
  id: "customers",
  title: "Customers",
  description: "",
  label: "name",
  content: (field) => ({
    name: field.string({ default: "Never fabricate" }),
    logo: field.image(),
    images: field.imageList(),
    download: field.file({ accept: ["application/pdf"] }),
    downloads: field.fileList({ accept: ["application/pdf"] }),
  }),
});
const id = "c0f2b5f1-ffb8-4aa1-a052-42a27caa8555";
const record: ReferenceRecord = {
  id,
  collectionId: "customers",
  label: "Source label",
  version: 1,
  content: { name: "Acme", logo: null, images: [] },
};

void test("reference schema stores nullable identity, defaults unset and emits per-use Markdown", () => {
  const reference = contentFieldBuilder.reference(customers, { required: true });
  assert.equal(reference.fieldType, "Reference");
  assert.equal(reference.collectionId, "customers");
  assert.equal(reference.default, null);
  assert.equal(reference.required, true);
  assert.deepEqual(reference.anyOf, [{ type: "string", format: "uuid" }, { type: "null" }]);
  const block = createBlock({
    id: "reference",
    title: "",
    description: "",
    content: () => ({ customer: reference }),
    settings: (setting) => ({ show: setting.boolean({ default: true }) }),
    component: () => null,
    toMarkdown: (c, s) => [s.show(`Quote: ${c.customer.name}`), c.customer.name],
  });
  assert.deepEqual(block._internal.getInitialContent(), { customer: null });
  assert.deepEqual(block._internal.getPeekBundle().block.content, { customer: null });
  assert.deepEqual(block._internal.contentSchema.toMarkdown, [
    "{{#if settings.show}}Quote: {{customer.name}}{{/if}}",
    "{{customer.name}}",
  ]);
});

void test("public scopes render source fields and labels, never fabricate missing records", () => {
  let calls = 0;
  const block = createBlock({
    id: "reference",
    title: "",
    description: "",
    content: (field) => ({ customer: field.reference(customers) }),
    toMarkdown: (c) => [c.customer.name],
    component: () => (
      <block.Reference name="customer">
        {(customer) => {
          calls++;
          return (
            <section aria-label={customer.label}>
              <customer.Field name="name">{(props) => <h2 {...props} />}</customer.Field>
              <customer.Image name="logo">{(props) => <img {...props} />}</customer.Image>
              <customer.ImageList name="images">{(props) => <img {...props} />}</customer.ImageList>
              <customer.File name="download">{(props) => <a {...props}>File</a>}</customer.File>
              <customer.FileList name="downloads">
                {(props) => <a {...props}>Files</a>}
              </customer.FileList>
            </section>
          );
        }}
      </block.Reference>
    ),
  });
  const render = (value: string | null, source?: ReferenceRecord, files: NormalizedFile[] = []) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider
          value={{ projectSlug: "test" } as React.ContextType<typeof AuthContext>}
        >
          <NavigationProvider>
            <NormalizedDataProvider
              files={files}
              repeatableItems={[]}
              blocks={[{ references: { customer: source ?? null } }]}
            >
              <block._internal.Component
                mode="site"
                blockData={{
                  _id: 1,
                  type: "reference",
                  position: "a0",
                  content: { customer: value },
                }}
              />
            </NormalizedDataProvider>
          </NavigationProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
  assert.match(render(id, record), /aria-label="Source label"><h2><span>Acme<\/span><\/h2>/);
  assert.doesNotMatch(render(id, record), /<img|Never fabricate/);
  calls = 0;
  for (const [value, source] of [
    [null, record],
    [id, undefined],
    [id, { ...record, collectionId: "other" }],
  ] as const) {
    assert.doesNotMatch(render(value, source), /<section|Never fabricate/);
  }
  assert.equal(calls, 0);

  const image = {
    _fileId: "7",
    url: "https://example.test/published.png",
    alt: "Published logo",
    mimeType: "image/png",
    size: 100,
  };
  const file = {
    _fileId: "8",
    url: "https://example.test/published.pdf",
    filename: "published.pdf",
    mimeType: "application/pdf",
    size: 100,
  };
  const published = {
    ...record,
    content: { ...record.content, logo: image, images: [image], download: file, downloads: [file] },
  };
  for (const files of [
    [],
    [
      { id: 7, url: "https://example.test/mutable.png", alt: "Changed" } as NormalizedFile,
      { id: 8, url: "https://example.test/mutable.pdf", filename: "changed.pdf" } as NormalizedFile,
    ],
  ]) {
    const html = render(id, published, files);
    assert.equal((html.match(/<img /g) ?? []).length, 2);
    assert.equal((html.match(/href="https:\/\/example.test\/published.pdf"/g) ?? []).length, 2);
    assert.match(html, /published.png/);
    assert.match(html, /Published logo/);
    assert.doesNotMatch(html, /mutable|Changed|changed.pdf/);
  }
});

void test("occurrence identity is separate from source identity and resolution validates collection", () => {
  assert.notEqual(referenceOccurrenceId(1, "customer"), referenceOccurrenceId(2, "customer"));
  assert.notEqual(referenceOccurrenceId(1, "customer"), referenceOccurrenceId(1, "other"));
  const records = new Map([[id, record]]);
  assert.equal(resolveReference(id, "customers", records), record);
  assert.equal(resolveReference(id, "other", records), null);
  assert.equal(resolveReference(null, "customers", records), null);
});

void test("two occurrences serialize shared source edits without clobbering another field", async () => {
  const writer = new ReferenceWrites();
  const requests: Array<{ expectedVersion: number; content: Record<string, unknown> }> = [];
  const save = async (input: (typeof requests)[number]) => {
    requests.push(input);
    await Promise.resolve();
    return { id, version: input.expectedVersion + 1, draft: input.content };
  };
  await Promise.all([
    writer.save(record, "name", "First", save),
    writer.save({ ...record }, "quote", "Second", save),
    writer.save({ ...record }, "name", "Third", save),
  ]);
  assert.deepEqual(
    requests.map((r) => r.expectedVersion),
    [1, 2, 3],
  );
  assert.deepEqual(requests[2].content, { ...record.content, name: "Third", quote: "Second" });
  assert.equal(record.content.name, "Acme");
});

void test("failed source writes do not retry or advance queued expected versions", async () => {
  const writer = new ReferenceWrites();
  let calls = 0;
  const save = async () => {
    calls++;
    throw new Error("conflict");
  };
  const results = await Promise.allSettled([
    writer.save(record, "name", "One", save),
    writer.save(record, "name", "Two", save),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((r) => r.status),
    ["rejected", "rejected"],
  );
  await assert.rejects(writer.save({ ...record, version: undefined }, "name", "Live", save));
  assert.equal(calls, 1);
});
