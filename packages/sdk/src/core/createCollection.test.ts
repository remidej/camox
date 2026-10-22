import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApp } from "./createApp";
import { createCollection } from "./createCollection";
import { contentFieldBuilder } from "./lib/contentType";

void describe("collection definitions", () => {
  const collection = createCollection({
    id: "articles",
    title: "Articles",
    description: "Editorial",
    content: (field) => ({
      title: field.string({ minLength: 1 }),
      kicker: field.string(),
      excerpt: field.string(),
      cover: field.image(),
    }),
    toTitle: ({ content }) => `${content.kicker}: ${content.title}`,
    toDescription: ({ content }) => content.excerpt,
  });
  void it("registers and serializes definitions without runtime functions", async () => {
    const app = createApp({ blocks: [], collections: [collection] });
    assert.deepEqual(app.getCollections(), [collection]);
    assert.equal(app.getCollectionById("articles"), collection);
    const [serialized] = JSON.parse(JSON.stringify((await app.getDefinitionSet()).collections));
    assert.equal(serialized.collectionId, "articles");
    assert.equal(serialized.toTitle, "{{kicker}}: {{title}}");
    assert.equal(serialized.toDescription, "{{excerpt}}");
    assert.deepEqual(serialized.contentSchema.required, ["title", "kicker", "excerpt", "cover"]);
    assert.equal(serialized.contentSchema.additionalProperties, false);
    assert.equal("default" in serialized.contentSchema.properties.title, false);
    assert.deepEqual(Object.keys(collection), ["pages", "_internal"]);
  });
  void it("serializes a description that returns nothing as no description", async () => {
    const undescribed = createCollection({
      id: "tags",
      title: "Tags",
      description: "",
      content: (field) => ({ name: field.string() }),
      toTitle: ({ content }) => content.name,
      toDescription: () => undefined,
    });
    const app = createApp({ blocks: [], collections: [undescribed] });
    const [serialized] = (await app.getDefinitionSet()).collections;
    assert.equal(serialized!.toDescription, null);
  });
  void it("rejects duplicate registration and templates naming no String field", () => {
    assert.throws(
      () => createApp({ blocks: [], collections: [collection, collection] }),
      /Duplicate collection/,
    );
    assert.throws(
      () =>
        createCollection({
          id: "bad",
          title: "",
          description: "",
          content: (field) => ({ cover: field.image() }),
          // @ts-expect-error Runtime protection for JavaScript callers.
          toTitle: ({ content }) => content.cover,
          toDescription: () => undefined,
        }),
      /String field/,
    );
  });
  void it("links other collections through references that are never required", () => {
    const authored = createCollection({
      id: "posts",
      title: "Posts",
      description: "",
      content: (field) => ({
        title: field.string({ minLength: 1 }),
        author: field.reference(collection, { title: "Author" }),
        related: field.referenceList(collection, { maxItems: 3 }),
      }),
      toTitle: ({ content }) => content.title,
      toDescription: () => undefined,
    });
    const { author, related } = authored._internal.contentSchema.properties;
    assert.equal(author.fieldType, "Reference");
    assert.equal(author.collectionId, "articles");
    assert.equal(author.required, false);
    assert.equal(related.fieldType, "ReferenceList");
    assert.equal(related.maxItems, 3);
  });
  void it("rejects unsupported field kinds at definition creation, not after authoring", () => {
    for (const unsupported of [
      contentFieldBuilder.link({ default: { text: "", href: "/", newTab: false } }),
      contentFieldBuilder.repeater({
        content: (field) => ({ text: field.string({ default: "" }) }),
        minItems: 1,
        maxItems: 2,
        toMarkdown: (c) => [c.text],
      }),
      { ...contentFieldBuilder.string({ default: "lucide:check" }), fieldType: "Icon" },
    ]) {
      assert.throws(
        () =>
          createCollection({
            id: "unsupported",
            title: "Unsupported",
            description: "",
            content: (field) => ({
              title: field.string({ default: "" }),
              unsupported,
            }),
            toTitle: ({ content }) => content.title,
            toDescription: () => undefined,
          }),
        /storage is not supported/,
      );
    }
  });
});
