import { describe, expect, it } from "vitest";

import { validateContent } from "./validate-content";

const string = { type: "string", fieldType: "String", minLength: 2, maxLength: 8 };
const image = {
  type: "object",
  fieldType: "Image",
  properties: { url: { type: "string" } },
  required: ["url"],
};
const item = {
  type: "object",
  properties: { title: string, image },
  required: ["title", "image"],
  additionalProperties: false,
};
const repeater = { type: "array", fieldType: "Repeater", items: item, maxItems: 2 };
const schema = {
  type: "object",
  properties: {
    title: string,
    count: { type: "integer", minimum: 1, maximum: 10, multipleOf: 2 },
    enabled: { type: "boolean" },
    choice: { type: "string", enum: ["one", "two"] },
    embed: { type: "string", fieldType: "Embed", pattern: "^https://example\\.com/" },
    settings: {
      type: "object",
      properties: { label: string },
      required: ["label"],
      additionalProperties: false,
    },
    image,
    items: repeater,
  },
  required: ["title", "image"],
};

function errorFor(value: unknown, contentSchema: unknown = schema, options = {}) {
  try {
    validateContent(value, contentSchema, options);
  } catch (error) {
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
    return error as { data: { field: string; errors: { path: string; message: string }[] } };
  }
  throw new Error("Expected content validation to fail");
}

describe("validateContent", () => {
  it.each([null, undefined, [], "text", 1, true])(
    "requires object content even without a known schema: %j",
    (value) => {
      expect(errorFor(value, null).data.field).toBe("content");
    },
  );

  it("accepts unknown schemas and open properties without injecting defaults", () => {
    for (const unknownSchema of [null, undefined, true, {}]) {
      expect(() => validateContent({ future: { anything: [1] } }, unknownSchema)).not.toThrow();
    }
    const value = { future: "preserved" };
    validateContent(value, { ...schema, properties: { title: { ...string, default: "Hello" } } });
    expect(value).toEqual({ future: "preserved" });
    expect(() => validateContent({}, false)).toThrow();
    expect(() => validateContent(value, { ...schema, additionalProperties: false })).toThrow();
  });

  it.each([
    ["title", 2],
    ["title", { root: { children: [] } }],
    ["title", "x"],
    ["title", "too many characters"],
    ["count", "2"],
    ["count", 1.5],
    ["count", 0],
    ["count", 12],
    ["count", 3],
    ["enabled", "false"],
    ["enabled", 0],
    ["choice", "three"],
    ["embed", { url: "https://example.com/" }],
    ["embed", "https://other.com/"],
  ])("delegates invalid %s values to JSON Schema: %j", (field, value) => {
    const error = errorFor({ [field as string]: value });
    expect(error.data.field).toBe(`content.${field}`);
    expect(error.data.errors).toContainEqual({
      path: `content.${field}`,
      message: expect.any(String),
    });
  });

  it("accepts valid scalar values, including Markdown strings", () => {
    validateContent(
      {
        title: "**Hi**",
        count: 2,
        enabled: false,
        choice: "one",
        embed: "https://example.com/video",
      },
      schema,
    );
  });

  it("patches only the top-level object; nested object replacements remain complete", () => {
    validateContent({ count: 2 }, schema);
    expect(() => validateContent({}, schema, { partial: false })).toThrow();
    expect(() => validateContent({ settings: {} }, schema)).toThrow();
    expect(() => validateContent({ settings: { label: "Hi", extra: true } }, schema)).toThrow();
    validateContent({ title: "Hello" }, schema, { partial: false });
  });

  it("uses separate partial and full variants of shared recursive local references", () => {
    const referenced = {
      $defs: {
        root: {
          type: "object",
          required: ["a", "b"],
          properties: {
            a: { type: "string" },
            b: { type: "string" },
            child: { $ref: "#/$defs/root" },
          },
          additionalProperties: false,
        },
      },
      $ref: "#/$defs/root",
    };
    const original = structuredClone(referenced);
    validateContent({ b: "new" }, referenced);
    validateContent({ child: { a: "a", b: "b", child: { a: "a", b: "b" } } }, referenced);
    expect(() => validateContent({ b: "new" }, referenced, { partial: false })).toThrow();
    expect(() => validateContent({ b: 2 }, referenced)).toThrow();
    expect(() => validateContent({ child: { b: "new" } }, referenced)).toThrow();
    expect(() =>
      validateContent({ child: { a: "a", b: "b", child: { b: "new" } } }, referenced),
    ).toThrow();
    expect(referenced).toEqual(original);
  });

  it("preserves document context for detached item schemas", () => {
    const rootSchema = {
      properties: {
        item: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
    };
    const detached = { $ref: "#/properties/item" };
    validateContent({ title: "Hi" }, detached, { partial: false, rootSchema });
    expect(() => validateContent({}, detached, { partial: false, rootSchema })).toThrow();
    validateContent({}, detached, { rootSchema });
  });

  it("accepts compatible oneOf patch branches while retaining anyOf and full exclusivity", () => {
    const alternatives = {
      type: "object",
      oneOf: [
        { required: ["a"], properties: { a: { type: "string" }, b: { type: "string" } } },
        { required: ["b"], properties: { a: { type: "string" }, b: { type: "string" } } },
      ],
      anyOf: [
        { properties: { count: { type: "integer", minimum: 1 } } },
        { properties: { count: { const: "auto" } } },
      ],
      allOf: [{ properties: { enabled: { type: "boolean" } } }],
    };
    validateContent({}, alternatives);
    validateContent({ b: "new", count: "auto" }, alternatives);
    expect(() => validateContent({ b: 3 }, alternatives)).toThrow();
    expect(() => validateContent({ count: 0 }, alternatives)).toThrow();
    expect(() => validateContent({ enabled: 1 }, alternatives)).toThrow();
    validateContent({ a: "yes" }, alternatives, { partial: false });
    expect(() =>
      validateContent({ a: "yes", b: "yes" }, alternatives, { partial: false }),
    ).toThrow();
    expect(() =>
      validateContent(
        { replacement: { a: "yes", b: "yes" } },
        { properties: { replacement: alternatives } },
      ),
    ).toThrow();
  });

  it("permits item markers through closed referenced and composed item schemas", () => {
    const referenced = {
      $defs: { item },
      properties: {
        items: {
          ...repeater,
          items: { allOf: [{ $ref: "#/$defs/item" }] },
        },
      },
    };
    const options = { allowItemReferences: true };
    validateContent({ items: [{ _itemId: 1 }] }, referenced, options);
    validateContent({ items: [{ _itemId: 1, title: "Hi" }] }, referenced, options);
    validateContent({ items: [{ title: "Hi" }] }, referenced, options);
    for (const invalid of [
      {},
      { _itemId: 0 },
      { _itemId: 1, title: 2 },
      { _itemId: 1, unknown: true },
    ]) {
      expect(() => validateContent({ items: [invalid] }, referenced, options)).toThrow();
    }
    expect(() => validateContent({ items: [{ _itemId: 1 }] }, referenced)).toThrow();
  });

  it("reports every scalar error with custom root and array index paths", () => {
    const error = errorFor({ count: "2", items: [{ title: 3 }] }, schema, {
      path: "repeatableItems[0].content",
    });
    expect(error.data.errors).toEqual(
      expect.arrayContaining([
        { path: "repeatableItems[0].content.count", message: expect.any(String) },
        { path: "repeatableItems[0].content.items[0].title", message: expect.any(String) },
      ]),
    );
  });

  it("projects stored and hydrated assets without changing either input", () => {
    const value = {
      image: { _fileId: "42", url: "invented", alt: "extra" },
      images: [null, { _fileId: 3 }, { url: "placeholder" }],
    };
    const assets = {
      properties: {
        image,
        images: { type: "array", fieldType: "ImageList", items: image, maxItems: 3 },
      },
      required: ["image", "images"],
    };
    const originalValue = structuredClone(value);
    const originalSchema = structuredClone(assets);
    validateContent(value, assets, { partial: false });
    validateContent({}, assets, { partial: false });
    expect(value).toEqual(originalValue);
    expect(assets).toEqual(originalSchema);
    expect(() => validateContent({ images: "not an array" }, assets)).toThrow();
    expect(() => validateContent({ images: [null, null, null, null] }, assets)).toThrow();
  });

  it.each([null, "url", {}, { _fileId: "invalid" }, { url: "placeholder" }])(
    "accepts assets that the normalizer turns into null: %j",
    (image) => validateContent({ image }, schema),
  );

  it("requires fresh repeater items, but not asset render placeholders", () => {
    validateContent({ items: [{ title: "Hello" }] }, schema);
    expect(() => validateContent({ items: [{}] }, schema)).toThrow();
    expect(() => validateContent({ items: [null] }, schema)).toThrow();
    expect(() => validateContent({ items: "wrong" }, schema)).toThrow();
    expect(() =>
      validateContent({ items: [{ title: "Hi" }, { title: "Hi" }, { title: "Hi" }] }, schema),
    ).toThrow();
    validateContent(
      { items: [{}] },
      {
        properties: { items: { ...repeater, items: { properties: { title: string } } } },
      },
    );
  });

  it("allows positive integer item references only when explicitly enabled", () => {
    expect(() => validateContent({ items: [{ _itemId: 1 }] }, schema)).toThrow();
    validateContent({ items: [{ _itemId: 1 }] }, schema, { allowItemReferences: true });
    validateContent({ items: [{ _itemId: 1, title: "Hi" }] }, schema, {
      allowItemReferences: true,
    });
    for (const id of [0, -1, 1.2, "1", null]) {
      expect(() =>
        validateContent({ items: [{ _itemId: id }] }, schema, { allowItemReferences: true }),
      ).toThrow();
    }
    expect(() =>
      validateContent({ items: [{ _itemId: 1, title: 3 }] }, schema, { allowItemReferences: true }),
    ).toThrow();
    expect(() =>
      validateContent({ items: [{ _itemId: 1, unknown: 3 }] }, schema, {
        allowItemReferences: true,
      }),
    ).toThrow();
    expect(() => validateContent({ items: [{}] }, schema, { allowItemReferences: true })).toThrow();
  });

  it("recurses through nested repeater references and validates their overrides", () => {
    const nested = {
      properties: {
        groups: {
          ...repeater,
          items: { ...item, properties: { title: string, children: repeater } },
        },
      },
    };
    const value = { groups: [{ _itemId: 1, children: [{ _itemId: 2 }] }] };
    validateContent(value, nested, { allowItemReferences: true });
    expect(() => validateContent(value, nested)).toThrow();
    const error = errorFor(
      { groups: [{ _itemId: 1, children: [{ _itemId: 2, title: false }] }] },
      nested,
      { allowItemReferences: true },
    );
    expect(error.data.errors).toEqual(
      expect.arrayContaining([
        { path: "content.groups[0].children[0].title", message: expect.any(String) },
      ]),
    );
  });

  it("honors array constraints, composition, references and conditional schemas", () => {
    const composed = {
      $defs: { positive: { type: "number", exclusiveMinimum: 0 } },
      properties: {
        number: { $ref: "#/$defs/positive" },
        union: { anyOf: [{ type: "string" }, { type: "boolean" }] },
        list: { type: "array", minItems: 1, uniqueItems: true, items: { type: "integer" } },
        all: { allOf: [{ type: "number" }, { maximum: 3 }] },
        single: { oneOf: [{ type: "integer" }, { type: "string" }] },
      },
      if: { properties: { union: { const: true } }, required: ["union"] },
      // eslint-disable-next-line unicorn/no-thenable
      then: { properties: { all: { const: 1 } } },
    };
    validateContent({ number: 2, union: true, list: [1], all: 1, single: "yes" }, composed);
    for (const value of [
      { number: 0 },
      { union: {} },
      { list: [] },
      { list: [1, 1] },
      { list: ["1"] },
      { all: 4 },
      { single: false },
      { union: true, all: 2 },
    ]) {
      expect(() => validateContent(value, composed)).toThrow();
    }
  });
});
