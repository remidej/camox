import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApp } from "./createApp";
import { createCollection, Type } from "./createCollection";

void describe("collection definitions", () => {
  const collection = createCollection({
    id: "articles",
    title: "Articles",
    description: "Editorial",
    content: { title: Type.String({ default: "" }), cover: Type.Image() },
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
          content: { cover: Type.Image() },
          // @ts-expect-error Runtime protection for JavaScript callers.
          label: "cover",
        }),
      /String field/,
    );
  });
  void it("rejects unsupported field kinds at definition creation, not after authoring", () => {
    for (const field of [
      Type.Link({ default: { text: "", href: "/", newTab: false } }),
      Type.Repeater({
        content: { text: Type.String({ default: "" }) },
        minItems: 1,
        maxItems: 2,
        toMarkdown: (c) => [c.text],
      }),
      { ...Type.String({ default: "lucide:check" }), fieldType: "Icon" },
    ]) {
      assert.throws(
        () =>
          createCollection({
            id: "unsupported",
            title: "Unsupported",
            description: "",
            content: {
              title: Type.String({ default: "" }),
              unsupported: field,
            },
            label: "title",
          }),
        /storage is not supported/,
      );
    }
  });
});
