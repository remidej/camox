import { describe, expect, it } from "vite-plus/test";

import {
  accepts,
  assetShape,
  collectFileIds,
  defaultOf,
  fieldOf,
  fieldsOf,
  itemSchemas,
  pointersIn,
  pointersOf,
  readField,
} from "./fields";

describe("fieldsOf", () => {
  it("reads each field of a stored schema with its kind, name and title", () => {
    const fields = fieldsOf({
      type: "object",
      properties: {
        headline: { fieldType: "String", title: "Headline" },
        visible: { fieldType: "Boolean" },
      },
    });
    expect(fields.map(({ name, kind, title }) => ({ name, kind, title }))).toEqual([
      { name: "headline", kind: "String", title: "Headline" },
      { name: "visible", kind: "Boolean", title: "visible" },
    ]);
  });
});

describe("fieldsOf on stored schemas that outlived their shape (ADR 0007)", () => {
  it.each([null, undefined, "schema", [], { properties: null }, { properties: [1] }])(
    "reads no fields from %j",
    (schema) => {
      expect(fieldsOf(schema)).toEqual([]);
    },
  );

  it("skips entries that aren't field schemas and reads unknown kinds as Unknown", () => {
    const fields = fieldsOf({
      properties: { broken: "nope", legacy: { fieldType: "Video" }, bare: { default: 3 } },
    });
    expect(fields.map(({ name, kind }) => [name, kind])).toEqual([
      ["legacy", "Unknown"],
      ["bare", "Unknown"],
    ]);
  });

  it("reads a reference that names no collection as Unknown, since it points nowhere", () => {
    expect(fieldsOf({ properties: { author: { fieldType: "Reference" } } })[0].kind).toBe(
      "Unknown",
    );
  });
});

describe("what fieldsOf tells about each kind", () => {
  const field = (schema: Record<string, unknown>) => fieldsOf({ properties: { f: schema } })[0];

  it("gives an asset list the accepted types its single asset declares", () => {
    expect(
      field({ fieldType: "FileList", items: { fieldType: "File", accept: ["application/pdf"] } }),
    ).toMatchObject({ kind: "FileList", accept: ["application/pdf"] });
    expect(field({ fieldType: "Image", accept: ["image/*"], required: true })).toMatchObject({
      kind: "Image",
      accept: ["image/*"],
      required: true,
    });
    expect(field({ fieldType: "File", accept: "image/*" })).toMatchObject({ accept: undefined });
  });

  it("gives a repeater its items' content and settings schemas and starting item count", () => {
    const items = { properties: { title: { fieldType: "String" } } };
    const itemSettings = { properties: { dark: { fieldType: "Boolean" } } };
    expect(
      field({ fieldType: "Repeater", items, itemSettingsSchema: itemSettings, minItems: 2 }),
    ).toMatchObject({
      kind: "Repeater",
      itemContentSchema: items,
      itemSettingsSchema: itemSettings,
      defaultItems: 2,
    });
    expect(field({ fieldType: "Repeater", defaultItems: 3, minItems: 1 })).toMatchObject({
      defaultItems: 3,
    });
    expect(field({ fieldType: "Repeater" })).toMatchObject({
      itemContentSchema: undefined,
      itemSettingsSchema: undefined,
      defaultItems: 0,
    });
  });

  it("gives a reference its collection and that collection's record schema", () => {
    const recordSchema = { properties: { name: { fieldType: "String" } } };
    expect(
      field({ fieldType: "Reference", collectionId: "authors", referenceSchema: recordSchema }),
    ).toMatchObject({ kind: "Reference", collectionId: "authors", recordSchema, required: false });
  });

  it("tells a query-backed reference list from a manual one", () => {
    const list = { fieldType: "ReferenceList", collectionId: "posts", maxItems: 5 };
    expect(field(list)).toMatchObject({ queryBacked: false, maxItems: 5 });
    expect(field({ ...list, query: { limit: 3 } })).toMatchObject({ queryBacked: true });
  });

  it("gives an enum its options", () => {
    expect(field({ fieldType: "Enum", enum: ["left", "right"] })).toMatchObject({
      options: ["left", "right"],
    });
    expect(field({ fieldType: "Enum" })).toMatchObject({ options: [] });
  });
});

describe("defaultOf", () => {
  const field = (schema: Record<string, unknown>) => fieldsOf({ properties: { f: schema } })[0];

  it("gives block content a fresh copy of the field's default", () => {
    const link = field({ fieldType: "Link", default: { text: "More", href: "/" } });
    const first = defaultOf(link, "block");
    expect(first).toEqual({ value: { text: "More", href: "/" } });
    (first!.value as { text: string }).text = "Changed";
    expect(defaultOf(link, "block")).toEqual({ value: { text: "More", href: "/" } });
  });

  it("keeps the default of a field whose kind it doesn't know", () => {
    expect(defaultOf(field({ default: 3 }), "block")).toEqual({ value: 3 });
  });

  it.each([
    ["an image", { fieldType: "Image", default: { url: "placeholder.png" } }],
    ["a file", { fieldType: "File", default: { url: "placeholder.pdf" } }],
    ["an image list", { fieldType: "ImageList", default: [{ url: "placeholder.png" }] }],
    ["a repeater, whose items are rows", { fieldType: "Repeater", default: [{}] }],
    ["a field without a default", { fieldType: "String" }],
  ])("stores no default in block content for %s", (_, schema) => {
    expect(defaultOf(field(schema), "block")).toBeUndefined();
  });

  it("gives a collection record the field's default, except an asset's placeholder", () => {
    expect(defaultOf(field({ fieldType: "String", default: "Untitled" }), "record")).toEqual({
      value: "Untitled",
    });
    expect(
      defaultOf(field({ fieldType: "Image", default: { url: "placeholder.png" } }), "record"),
    ).toEqual({ value: null });
  });

  it.each([
    [{ fieldType: "String" }, ""],
    [{ fieldType: "Embed" }, ""],
    [{ fieldType: "Boolean" }, false],
    [{ fieldType: "Enum", enum: ["draft", "final"] }, "draft"],
    [{ fieldType: "Enum" }, ""],
    [{ fieldType: "Image" }, null],
    [{ fieldType: "File" }, null],
    [{ fieldType: "Reference", collectionId: "authors" }, null],
    [{ fieldType: "ImageList" }, []],
    [{ fieldType: "FileList" }, []],
    [{ fieldType: "ReferenceList", collectionId: "posts" }, []],
  ])("gives a collection record without a default the empty value of %j", (schema, empty) => {
    expect(defaultOf(field(schema), "record")).toEqual({ value: empty });
  });
});

const PAGE = "01900000-0000-7000-8000-000000000001";
const OTHER_PAGE = "01900000-0000-7000-8000-000000000002";
const RECORD = "01900000-0000-7000-8000-000000000003";
const OTHER_RECORD = "01900000-0000-7000-8000-000000000004";
const FILE = "01900000-0000-7000-8000-000000000005";
const OTHER_FILE = "01900000-0000-7000-8000-000000000006";

/** Lexical rich text linking to each page, as String fields store it. */
function richTextLinking(...pageIds: string[]) {
  return JSON.stringify({
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: pageIds.map((id) => ({
            type: "link",
            url: `camox:page:${id}`,
            children: [{ type: "text", text: "a page" }],
          })),
        },
      ],
    },
  });
}

describe("pointersOf", () => {
  const field = (schema: Record<string, unknown>) => fieldsOf({ properties: { f: schema } })[0];
  const reference = field({ fieldType: "Reference", collectionId: "authors" });
  const list = field({ fieldType: "ReferenceList", collectionId: "posts" });

  it("points a reference at its collection record", () => {
    expect(pointersOf(reference, RECORD)).toEqual([
      { to: "record", collectionId: "authors", id: RECORD },
    ]);
  });

  it.each([null, undefined, "", 42, { id: RECORD }])(
    "points an empty reference (%j) nowhere",
    (value) => {
      expect(pointersOf(reference, value)).toEqual([]);
    },
  );

  it("points a manual reference list at its records once each, in order", () => {
    expect(pointersOf(list, [OTHER_RECORD, RECORD, OTHER_RECORD, "", 7])).toEqual([
      { to: "record", collectionId: "posts", id: OTHER_RECORD },
      { to: "record", collectionId: "posts", id: RECORD },
    ]);
  });

  it("points a query-backed reference list nowhere, whatever it stores", () => {
    const queried = field({ fieldType: "ReferenceList", collectionId: "posts", query: {} });
    expect(pointersOf(queried, [RECORD])).toEqual([]);
  });

  it("points a link at its page only while it links a page", () => {
    const link = field({ fieldType: "Link" });
    expect(pointersOf(link, { type: "page", pageId: PAGE, text: "Home" })).toEqual([
      { to: "page", id: PAGE },
    ]);
    expect(pointersOf(link, { type: "page", pageId: "" })).toEqual([]);
    // An external link keeps whatever page it linked before, but renders its href.
    expect(pointersOf(link, { type: "external", href: "https://camox.ai", pageId: PAGE })).toEqual(
      [],
    );
  });

  it("points rich text at the pages its links name", () => {
    const text = field({ fieldType: "String" });
    expect(pointersOf(text, richTextLinking(PAGE, OTHER_PAGE))).toEqual([
      { to: "page", id: PAGE },
      { to: "page", id: OTHER_PAGE },
    ]);
    expect(pointersOf(text, "Plain text naming camox:page:" + PAGE)).toEqual([]);
  });

  it("points images and files at their files", () => {
    expect(pointersOf(field({ fieldType: "Image" }), { _fileId: FILE, url: "/a.png" })).toEqual([
      { to: "file", id: FILE },
    ]);
    expect(pointersOf(field({ fieldType: "File" }), { url: "placeholder.pdf" })).toEqual([]);
    expect(
      pointersOf(field({ fieldType: "ImageList" }), [
        { _fileId: FILE },
        null,
        { _fileId: OTHER_FILE },
        { _fileId: FILE },
      ]),
    ).toEqual([
      { to: "file", id: FILE },
      { to: "file", id: OTHER_FILE },
    ]);
  });

  it.each([
    [{ fieldType: "Embed" }, "https://youtube.com/watch?v=" + RECORD],
    [{ fieldType: "Enum", enum: [RECORD] }, RECORD],
    [{ fieldType: "Artifact" }, `<a href="camox:page:${PAGE}">`],
    [{ fieldType: "Repeater" }, [{ _fileId: FILE }]],
    [{ default: 1 }, { _fileId: FILE }],
  ])("points %j nowhere, even when its value looks like a pointer", (schema, value) => {
    expect(pointersOf(field(schema), value)).toEqual([]);
  });
});

describe("pointersIn", () => {
  it("lists what each field of content points at, by field", () => {
    const schema = {
      properties: {
        author: { fieldType: "Reference", collectionId: "authors" },
        cover: { fieldType: "Image" },
        body: { fieldType: "String" },
        stale: { fieldType: "Embed" },
      },
    };
    const found = pointersIn(schema, {
      author: RECORD,
      cover: { _fileId: FILE },
      body: richTextLinking(PAGE),
      removedField: { _fileId: OTHER_FILE },
    });
    expect(found.map(({ field, pointer }) => [field.name, pointer])).toEqual([
      ["author", { to: "record", collectionId: "authors", id: RECORD }],
      ["cover", { to: "file", id: FILE }],
      ["body", { to: "page", id: PAGE }],
    ]);
  });

  it.each([null, "content", [RECORD]])(
    "finds nothing in content that isn't an object: %j",
    (content) => {
      expect(
        pointersIn(
          { properties: { author: { fieldType: "Reference", collectionId: "a" } } },
          content,
        ),
      ).toEqual([]);
    },
  );
});

describe("collectFileIds", () => {
  const collect = (value: unknown) => {
    const ids = new Set<string>();
    collectFileIds(value, ids);
    return [...ids];
  };

  it("finds every stored file marker, however deep, without a schema", () => {
    // A block read with its resolved references: records nest their content and their own
    // references, and items carry content beside settings.
    const hydrated = {
      cover: { _fileId: FILE, url: "/cover.png" },
      gallery: [{ _fileId: OTHER_FILE }],
      author: {
        id: RECORD,
        content: { avatar: { _fileId: "01900000-0000-7000-8000-000000000007" } },
        references: {
          team: { content: { logo: { _fileId: "01900000-0000-7000-8000-000000000008" } } },
        },
      },
    };
    expect(collect(hydrated).sort()).toEqual(
      [
        FILE,
        OTHER_FILE,
        "01900000-0000-7000-8000-000000000007",
        "01900000-0000-7000-8000-000000000008",
      ].sort(),
    );
  });

  it("ignores markers that hold no id", () => {
    expect(collect({ a: { _fileId: "" }, b: { _fileId: 5 }, c: { url: "/x.png" } })).toEqual([]);
  });

  it("finds at least every file the content's fields point at", () => {
    const schema = {
      properties: {
        cover: { fieldType: "Image" },
        gallery: { fieldType: "FileList" },
        title: { fieldType: "String" },
      },
    };
    const content = {
      cover: { _fileId: FILE },
      gallery: [{ _fileId: OTHER_FILE }, { _fileId: FILE }],
      title: "Hello",
      removedField: { _fileId: "01900000-0000-7000-8000-000000000009" },
    };
    const pointed = pointersIn(schema, content).map(({ pointer }) => pointer.id);
    expect(pointed).toEqual([FILE, OTHER_FILE, FILE]);
    expect(collect(content)).toEqual(expect.arrayContaining(pointed));
  });
});

describe("itemSchemas", () => {
  const cardContent = { properties: { title: { fieldType: "String" } } };
  const cardSettings = { properties: { highlighted: { fieldType: "Boolean" } } };
  const sectionContent = {
    properties: {
      heading: { fieldType: "String" },
      cards: {
        fieldType: "Repeater",
        items: cardContent,
        itemSettingsSchema: cardSettings,
      },
    },
  };
  const blockSchema = {
    properties: {
      title: { fieldType: "String" },
      sections: { fieldType: "Repeater", items: sectionContent },
    },
  };
  const item = (id: string, fieldName: string, parentItemId: string | null = null) => ({
    id,
    fieldName,
    parentItemId,
  });

  it("finds each repeatable item's content and settings schemas through its parents", () => {
    // Children may come before their parents.
    const schemas = itemSchemas(blockSchema, [
      item("card", "cards", "section"),
      item("section", "sections"),
    ]);
    expect(schemas.get("section")).toMatchObject({
      repeater: { name: "sections", kind: "Repeater" },
      content: sectionContent,
      settings: undefined,
    });
    expect(schemas.get("card")).toMatchObject({
      repeater: { name: "cards" },
      content: cardContent,
      settings: cardSettings,
    });
  });

  it("leaves out items whose repeater, or whose parent, is gone", () => {
    const schemas = itemSchemas(blockSchema, [
      item("removed", "faqs"),
      item("notRepeater", "title"),
      item("orphan", "cards", "missing"),
      item("underRemoved", "cards", "removed"),
    ]);
    expect([...schemas.keys()]).toEqual([]);
  });

  it("leaves out items whose parents form a cycle", () => {
    const schemas = itemSchemas(blockSchema, [item("a", "cards", "b"), item("b", "cards", "a")]);
    expect(schemas.size).toBe(0);
  });

  it("finds nothing under a definition that is gone", () => {
    expect(itemSchemas(undefined, [item("section", "sections")]).size).toBe(0);
  });
});

describe("accepts", () => {
  const fileField = (accept: unknown) =>
    fieldsOf({ properties: { f: { fieldType: "File", accept } } })[0];
  const pdf = { mimeType: "application/pdf", filename: "Brochure.PDF" };
  const png = { mimeType: "image/png", filename: "logo.png" };

  it.each([
    [["application/pdf"], pdf, true],
    [["application/pdf"], png, false],
    [["image/*"], png, true],
    [["image/*"], pdf, false],
    [[".pdf"], pdf, true],
    [[" Application/PDF "], pdf, true],
    [["*"], pdf, true],
    [["*/*"], png, true],
  ])("a field accepting %j takes %j: %s", (accept, file, expected) => {
    expect(accepts(fileField(accept), file)).toBe(expected);
  });

  it("takes any file when the field names no accepted types", () => {
    expect(accepts(fileField(undefined), pdf)).toBe(true);
    expect(accepts(fileField([]), pdf)).toBe(true);
  });

  it("reads an asset list's accepted types from its single asset", () => {
    const list = fieldsOf({
      properties: {
        f: { fieldType: "ImageList", items: { fieldType: "Image", accept: ["image/*"] } },
      },
    })[0];
    expect(accepts(list, pdf)).toBe(false);
    expect(accepts(list, png)).toBe(true);
  });
});

describe("fieldOf", () => {
  const schema = { properties: { title: { fieldType: "String" }, toString: "no" } };

  it("reads one field of a schema by name", () => {
    expect(fieldOf(schema, "title")).toMatchObject({ name: "title", kind: "String" });
  });

  it.each(["missing", "toString", "constructor"])("finds no field named %s", (name) => {
    expect(fieldOf(schema, name)).toBeUndefined();
  });
});

describe("readField", () => {
  it("reads a field schema wherever it sits, such as an asset list's single asset", () => {
    expect(readField({ fieldType: "Image", accept: ["image/*"] })).toMatchObject({
      name: "",
      kind: "Image",
      accept: ["image/*"],
    });
  });

  it.each([null, "Image", [{ fieldType: "Image" }]])("reads no field from %j", (schema) => {
    expect(readField(schema)).toBeUndefined();
  });
});

describe("assetShape", () => {
  it.each([
    ["Image", "single"],
    ["File", "single"],
    ["ImageList", "list"],
    ["FileList", "list"],
    ["ReferenceList", undefined],
    ["String", undefined],
    [undefined, undefined],
  ])("%s holds %s files", (kind, shape) => {
    expect(assetShape(kind)).toBe(shape);
  });
});
