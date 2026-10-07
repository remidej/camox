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
    content: (field) => ({ title: field.string({ minLength: 1 }), cover: field.image() }),
    label: "title",
  });
  void it("registers and serializes definitions without runtime functions", () => {
    const app = createApp({ blocks: [], collections: [collection] });
    assert.deepEqual(app.getCollections(), [collection]);
    assert.equal(app.getCollectionById("articles"), collection);
    const [serialized] = JSON.parse(JSON.stringify(app.getSerializableCollectionDefinitions()));
    assert.equal(serialized.collectionId, "articles");
    assert.equal(serialized.label, "title");
    assert.deepEqual(serialized.contentSchema.required, ["title", "cover"]);
    assert.equal(serialized.contentSchema.additionalProperties, false);
    assert.equal("default" in serialized.contentSchema.properties.title, false);
    assert.deepEqual(Object.keys(collection), ["_internal"]);
  });
  void it("rejects duplicate registration and invalid JavaScript labels", () => {
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
          // @ts-expect-error Runtime protection for JavaScript callers.
          content: (field) => ({ cover: field.image() }),
          label: "cover",
        }),
      /String field/,
    );
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
            label: "title",
          }),
        /storage is not supported/,
      );
    }
  });
});
